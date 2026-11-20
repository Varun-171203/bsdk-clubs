import React, { useState, useEffect } from 'react';
import { isNativeApp } from '../api.js';
import { MobileAuthScreen } from './MobileAuthScreen.jsx';
import { WebLandingAuth } from './WebLandingAuth.jsx';

/**
 * AuthScreen router:
 * - When running in the Android APK (`isNativeApp() === true`), the web landing page
 *   is completely removed. Users get a dedicated, native-feeling mobile login interface.
 * - When viewed on mobile screen widths (< 860px), it also serves the clean mobile interface.
 * - Desktop web users get the full desktop presentation with interactive chat demo and walkthrough.
 */
export function AuthScreen({ onAuthenticated }) {
  const [isMobileView, setIsMobileView] = useState(() => {
    if (isNativeApp()) return true;
    if (typeof window !== 'undefined') {
      return window.innerWidth < 860;
    }
    return false;
  });

  useEffect(() => {
    // If native APK, always stay in mobile auth mode
    if (isNativeApp()) {
      setIsMobileView(true);
      return;
    }

    function handleResize() {
      setIsMobileView(window.innerWidth < 860);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (isMobileView || isNativeApp()) {
    return <MobileAuthScreen onAuthenticated={onAuthenticated} />;
  }

  return <WebLandingAuth onAuthenticated={onAuthenticated} />;
}
