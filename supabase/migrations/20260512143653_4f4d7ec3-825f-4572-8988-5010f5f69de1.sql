
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.session_source AS ENUM ('pi', 'webcam');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_manage" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ VOCABULARIES ============
CREATE TABLE public.vocabularies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word_index INT NOT NULL UNIQUE,
  word TEXT NOT NULL UNIQUE,
  description TEXT,
  video_url TEXT,
  difficulty INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vocabularies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vocabularies_read_all" ON public.vocabularies FOR SELECT TO authenticated USING (true);
CREATE POLICY "vocabularies_admin_write" ON public.vocabularies FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ SESSIONS ============
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source session_source NOT NULL DEFAULT 'webcam',
  device_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  word_count INT NOT NULL DEFAULT 0,
  avg_confidence NUMERIC(5,2)
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX sessions_user_idx ON public.sessions(user_id, started_at DESC);

CREATE POLICY "sessions_owner_all" ON public.sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_admin_read" ON public.sessions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ PREDICTIONS ============
CREATE TABLE public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  confidence NUMERIC(5,2) NOT NULL,
  top3 JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
CREATE INDEX predictions_session_idx ON public.predictions(session_id, created_at);

CREATE POLICY "predictions_owner_all" ON public.predictions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "predictions_admin_read" ON public.predictions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ LESSON ATTEMPTS ============
CREATE TABLE public.lesson_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vocabulary_id UUID NOT NULL REFERENCES public.vocabularies(id) ON DELETE CASCADE,
  target_word TEXT NOT NULL,
  predicted_word TEXT,
  confidence NUMERIC(5,2),
  is_correct BOOLEAN NOT NULL DEFAULT false,
  top3 JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lesson_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX lesson_attempts_user_idx ON public.lesson_attempts(user_id, created_at DESC);

CREATE POLICY "attempts_owner_all" ON public.lesson_attempts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "attempts_admin_read" ON public.lesson_attempts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ USER PROGRESS ============
CREATE TABLE public.user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vocabulary_id UUID NOT NULL REFERENCES public.vocabularies(id) ON DELETE CASCADE,
  correct_count INT NOT NULL DEFAULT 0,
  total_count INT NOT NULL DEFAULT 0,
  mastery NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  UNIQUE(user_id, vocabulary_id)
);
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progress_owner_all" ON public.user_progress FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "progress_admin_read" ON public.user_progress FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ TRIGGERS ============
-- updated_at trigger for profiles
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto create profile + default user role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Recompute user_progress mastery when an attempt is inserted
CREATE OR REPLACE FUNCTION public.tg_update_progress()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_progress (user_id, vocabulary_id, correct_count, total_count, mastery, last_attempt_at)
  VALUES (NEW.user_id, NEW.vocabulary_id, CASE WHEN NEW.is_correct THEN 1 ELSE 0 END, 1,
          CASE WHEN NEW.is_correct THEN 100 ELSE 0 END, now())
  ON CONFLICT (user_id, vocabulary_id) DO UPDATE
  SET correct_count = public.user_progress.correct_count + (CASE WHEN NEW.is_correct THEN 1 ELSE 0 END),
      total_count   = public.user_progress.total_count + 1,
      mastery       = ROUND(100.0 * (public.user_progress.correct_count + (CASE WHEN NEW.is_correct THEN 1 ELSE 0 END))::numeric
                            / (public.user_progress.total_count + 1), 2),
      last_attempt_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER lesson_attempts_update_progress AFTER INSERT ON public.lesson_attempts FOR EACH ROW EXECUTE FUNCTION public.tg_update_progress();
