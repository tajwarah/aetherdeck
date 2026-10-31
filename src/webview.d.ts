// Electron's <webview> element, used by the desktop app (see components/LivePage.tsx).
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string; allowpopups?: string };
    }
  }
}
