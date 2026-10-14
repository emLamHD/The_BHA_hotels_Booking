import { useEffect } from "react";
import { createGlobalState } from "react-hooks-global-state";

const initialState = { isDarkmode: false };
const { useGlobalState } = createGlobalState(initialState);

// CUST-WEB-001-CP08a-C2: the storage is read and written defensively (a private window, blocked site data or
// a preview can make it throw; the page then keeps the theme for the tab) and a caller that mounts later —
// the mobile menu, the account menu — reads the real state of <html> instead of forcing the light theme.
const THEME_KEY = "theme";

function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function storeTheme(value: "dark" | "light") {
  try {
    window.localStorage.setItem(THEME_KEY, value);
  } catch {
    // keep the theme for this tab only
  }
}

export const useThemeMode = () => {
  const [isDarkMode, setIsDarkMode] = useGlobalState("isDarkmode");

  useEffect(() => {
    // Enbale this if you want use the dark-mode for default mode.
    // if (!localStorage.theme) {
    //   localStorage.theme = "dark";
    // }
    //
    const stored = readStoredTheme();
    if (stored === "dark") {
      toDark();
    } else if (stored === "light") {
      toLight();
    } else if (document.documentElement.classList.contains("dark")) {
      setIsDarkMode(true);
    } else {
      setIsDarkMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toDark = () => {
    setIsDarkMode(true);
    const root = document.querySelector("html");
    if (!root) return;
    !root.classList.contains("dark") && root.classList.add("dark");
    storeTheme("dark");
  };

  const toLight = () => {
    setIsDarkMode(false);
    const root = document.querySelector("html");
    if (!root) return;
    root.classList.remove("dark");
    storeTheme("light");
  };

  function _toogleDarkMode() {
    // The page itself is the truth: <html class="dark"> is what the palette follows.
    if (document.documentElement.classList.contains("dark")) {
      toLight();
    } else {
      toDark();
    }
  }

  return {
    isDarkMode,
    toDark,
    toLight,
    _toogleDarkMode,
  };
};
