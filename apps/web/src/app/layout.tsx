import type { Metadata } from "next";
import type { ReactNode } from "react";

import { capabilityLine } from "../../content/claims";

export const metadata: Metadata = {
  title: "Faff",
  description: capabilityLine,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
