import type { Metadata } from "next";

import { CoupleOnboardingGate } from "@/components/CoupleOnboardingGate";
import { DevAuthDebug } from "@/components/DevAuthDebug";

import "./globals.css";

export const metadata: Metadata = {
  title: "PuppyJourney（双宠奇旅）",
  description: "双人共同成长陪伴应用",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <CoupleOnboardingGate>
          {children}
          <DevAuthDebug />
        </CoupleOnboardingGate>
      </body>
    </html>
  );
}
