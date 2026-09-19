# RUNE — Fix: "leave anyway?" warning stuck on after leaving the Import screen

Confirmed against the current `app/upload/UploadClient.tsx` and
`components/NavHeader.tsx`. This is a real bug in the background-import redesign, not
something you're imagining being broader than it should be.

## Root cause

`NavHeader.tsx` reads `isBlocked`/`blockMessage` from the app-wide
`NavigationBlockerContext` (one shared instance, not per-page) and checks it on **every**
Back/Home click anywhere in the app (`guardedNavigate`/`handleBack`, lines 37-44). That's
by design — it's meant to intercept leaving *while* something is blocking.

The bug: `UploadClient.tsx` calls `setBlock(true, LEAVE_WARNING)` when an import starts,
and only ever calls `setBlock(false)` in two places — when the status poll sees the job
finish (line 145), or when the initial `/api/import/start` call itself fails (line 202).
If you navigate away *while an import is still running* (confirming the "leave anyway?"
prompt once, as intended), `UploadClient` unmounts right there — and neither of those two
`setBlock(false)` calls ever fires, because the component that would've fired them is
gone. `isBlocked` stays `true` in the shared context forever after that, so every future
Back/Home click on any other screen shows the same stale Import warning. This has been
there since the first background-import redesign, not introduced by the last two fixes —
just not noticed until now because usually the poll finishes and clears it before anyone
navigates away.

## Fix — `app/upload/UploadClient.tsx`

Add this new effect. Placement doesn't matter much; putting it right after the existing
mount effect (currently ending at line 113, the `fetch("/api/import/resume", ...)` one) is
a good spot:

```ts
  // Clears the navigation block if this component unmounts while it's still set - e.g. the
  // user confirmed the "leave anyway?" prompt and actually navigated away while an import
  // was still in flight. Without this, isBlocked stays stuck true in
  // NavigationBlockerProvider's app-wide state forever afterward (nothing else ever turns
  // it back off once this component is gone), so every future in-app navigation ANYWHERE
  // else in the app incorrectly shows this page's "leave anyway?" prompt too. Empty deps
  // deliberately: this must run its cleanup only on unmount, not every time setBlock's own
  // identity changes (it's a new function every time NavigationBlockerProvider re-renders),
  // or it would immediately undo the very block handleSubmit just set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => setBlock(false);
  }, []);
```

That's the required fix. Bump `lib/version.ts`'s `MINOR` from `30` to `31` and deploy.

## Optional (recommended) hardening — `components/NavigationBlocker.tsx`

Not required for the fix above to work, but worth doing at the same time since it's a
one-line-per-function change and removes a footgun for anyone who writes a similar
component in the future: `setBlock` is currently a brand-new function on every render of
`NavigationBlockerProvider` (it's declared plain, not wrapped in `useCallback`), which is
exactly why the new effect above has to use an empty dependency array with an eslint
suppression instead of the more normal `[setBlock]` — a changing dependency would refire
the effect (and its cleanup) on every block/unblock, immediately undoing itself. Wrapping
`setBlock` in `useCallback` gives it a stable identity so any future `useEffect` depending
on it behaves the way dependency arrays are supposed to, without needing a suppression
comment to work around it.

Current file:

```tsx
"use client";

import { createContext, useContext, useState } from "react";

const DEFAULT_MESSAGE = "Leave this page? Your changes may be lost.";

type NavigationBlockerContextType = {
  isBlocked: boolean;
  blockMessage: string;
  setBlock: (blocked: boolean, message?: string) => void;
};

const NavigationBlockerContext = createContext<NavigationBlockerContextType>({
  isBlocked: false,
  blockMessage: DEFAULT_MESSAGE,
  setBlock: () => {},
});

// Covers in-app navigation only (NavHeader's Back button and Home link, and any <Link
// onNavigate>) - there's no App Router hook to intercept the browser's own physical
// back/forward button (that's a Pages Router-only API, router.beforePopState). A real tab
// close/refresh/typed URL is instead covered separately by the native `beforeunload` event.
export function NavigationBlockerProvider({ children }: { children: React.ReactNode }) {
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockMessage, setBlockMessage] = useState(DEFAULT_MESSAGE);

  function setBlock(blocked: boolean, message?: string) {
    setIsBlocked(blocked);
    if (message) setBlockMessage(message);
  }

  return (
    <NavigationBlockerContext.Provider value={{ isBlocked, blockMessage, setBlock }}>
      {children}
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker() {
  return useContext(NavigationBlockerContext);
}
```

Change the `import` line and the `setBlock` declaration:

```tsx
import { createContext, useCallback, useContext, useState } from "react";
```

```tsx
  const setBlock = useCallback((blocked: boolean, message?: string) => {
    setIsBlocked(blocked);
    if (message) setBlockMessage(message);
  }, []);
```

If you make this change, you can then simplify the new effect in `UploadClient.tsx` back
to the normal form (no suppression comment needed):

```ts
  useEffect(() => {
    return () => setBlock(false);
  }, [setBlock]);
```

Either version (empty deps + suppression, or `useCallback` + `[setBlock]`) is correct on
its own — pick one, don't do both differently in different places.

## Test

1. Deploy the required fix (with or without the optional hardening).
2. Start an import, then immediately hit Back or Home and confirm "leave anyway?".
3. Navigate around a few other unrelated screens (Dashboards, Reports, Setup) — none of
   them should show the Import warning anymore.
4. Separately, re-confirm the warning still shows correctly the *next* time you start an
   import and try to leave mid-run — this fix only clears the stale stuck state, it
   shouldn't have turned the warning off for real in-progress imports.
