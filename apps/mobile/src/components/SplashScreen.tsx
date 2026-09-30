import { useEffect, useState } from 'react';

const SPLASH_DURATION_MS = 900;

export function SplashScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), SPLASH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="app-splash" role="presentation" aria-hidden="true">
      <svg
        className="app-splash-mark"
        viewBox="19 19 82 82"
        width="390"
        height="390"
        focusable="false"
      >
        <g className="app-splash-mark__construction">
          <circle className="app-splash-ring" cx="60" cy="60" r="35" pathLength="1" />
          <path className="app-splash-n app-splash-n--left" d="M46 27.9 L46 92.1" pathLength="1" />
          <path className="app-splash-n app-splash-n--right" d="M74 27.9 L74 92.1" pathLength="1" />
          <path className="app-splash-n app-splash-n--diagonal" d="M46 27.9 L74 92.1" pathLength="1" />
        </g>
      </svg>
    </div>
  );
}
