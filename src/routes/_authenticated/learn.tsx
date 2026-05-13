import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for /learn — renders child routes via Outlet:
//   learn.index.tsx   → renders the word list at /learn
//   learn.$wordId.tsx → renders the practice page at /learn/$wordId
export const Route = createFileRoute("/_authenticated/learn")({
  component: () => <Outlet />,
});
