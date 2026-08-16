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
