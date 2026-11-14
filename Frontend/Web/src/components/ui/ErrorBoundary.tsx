import { readStored } from "@/lib/browserStore";
import { isStaleBuildError, reloadOntoNewBuild } from "@/lib/staleBuild";
import { translate } from "@shared/i18n/dictionary";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

/**
 * The crash screen sits above the locale provider, so it cannot use the
 * translation hook — it reads the shopper's stored choice directly. Anything
 * unreadable there falls back to English rather than throwing inside the
 * handler for a throw.
 */
function crashLocale(): "en" | "ar" {
  return readStored("netlet:locale") === "ar" ? "ar" : "en";
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** A page of an old build that asked for a file the new deployment does not have. */
  stale: boolean;
  /** `public/asset-recovery.js` will not reload (every try spent): the reload is the shopper's. */
  cannotReload: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, stale: false, cannotReload: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, stale: isStaleBuildError(error) };
  }

  /* A stale build is nobody's fault and the cure is the new one: ask the
     recovery script for it here rather than in render, which must not start
     a reload. It answers false once every try is spent, and the screen then
     offers the reload by hand. */
  componentDidCatch(error: Error) {
    if (isStaleBuildError(error)) this.setState({ cannotReload: !reloadOntoNewBuild(error) });
  }

  render() {
    if (this.state.hasError) {
      const locale = crashLocale();
      if (this.state.stale) {
        return (
          <main dir={locale === "ar" ? "rtl" : "ltr"} className="flex min-h-screen items-center justify-center bg-background p-8">
            <div role="status" className="flex w-full max-w-md flex-col items-center p-8 text-center">
              <RefreshCw size={40} aria-hidden="true" className="mb-6 text-[#0a285a]" />
              <h1 className="mb-2 text-xl font-semibold text-[#0a285a]">{translate(locale, "error.updated")}</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                {translate(locale, this.state.cannotReload ? "error.updatedReload" : "error.updating")}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sg bg-[#0a285a] px-4 py-2 text-white hover:bg-[#0d3372]"
              >
                <RotateCcw size={16} aria-hidden="true" />
                {translate(locale, "error.reload")}
              </button>
            </div>
          </main>
        );
      }
      return (
        <main dir={locale === "ar" ? "rtl" : "ltr"} className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h1 className="text-xl mb-4">{translate(locale, "error.unexpected")}</h1>

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre dir="ltr" className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sg bg-[#0a285a] px-4 py-2 text-white hover:bg-[#0d3372]"
            >
              <RotateCcw size={16} />
              {translate(locale, "error.reload")}
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
