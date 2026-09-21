import { cn } from "@/lib/utils";
import { translate } from "@shared/i18n/dictionary";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

/**
 * The crash screen sits above the locale provider, so it cannot use the
 * translation hook — it reads the shopper's stored choice directly. Anything
 * unreadable there falls back to English rather than throwing inside the
 * handler for a throw.
 */
function crashLocale(): "en" | "ar" {
  try {
    return window.localStorage.getItem("netlet:locale") === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const locale = crashLocale();
      return (
        <div dir={locale === "ar" ? "rtl" : "ltr"} className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">{translate(locale, "error.unexpected")}</h2>

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre dir="ltr" className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-sg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              {translate(locale, "error.reload")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
