import * as React from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner } from "sonner";

/* shadcn ships this component wired to next-themes. The studio is a plain Vite
 * app that tracks the theme with a data-theme attribute on <html>, so read that
 * instead and follow it when the toggle in App.jsx flips. */
function useDocumentTheme() {
  const read = () =>
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  const [theme, setTheme] = React.useState(read);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

const Toaster = ({ ...props }) => {
  const theme = useDocumentTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group ui"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={{
        "--normal-bg": "var(--ui-popover)",
        "--normal-text": "var(--ui-popover-foreground)",
        "--normal-border": "var(--ui-border)",
        "--border-radius": "var(--ui-radius)",
      }}
      {...props}
    />
  );
};

export { Toaster };
