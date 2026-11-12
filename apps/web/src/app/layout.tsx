import type { Metadata } from "next";
import { ActionGuidance } from "@/components/action-guidance";
import { RequiredFieldGuidance } from "@/components/required-field-guidance";
import { StudioPreviewFeedback } from "@/components/studio-preview-feedback";
import "./styles.css";
import "./studio-preview.css";
import "./studio-motion.css";
import "@/components/required-field-guidance.css";
export const metadata: Metadata = {
  title: { default: "Lebanon · Research workspace", template: "%s · Lebanon" },
  description: "Private research validation workspace",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hosted = process.env.RVW_BACKEND_MODE === "hosted";
  const studioPreview = hosted || (
    process.env.RVW_BACKEND_MODE === "local" &&
    process.env.RVW_STUDIO_PREVIEW === "1"
  );
  const studioMotion = hosted || (studioPreview && process.env.RVW_STUDIO_MOTION === "1");
  return (
    <html lang="en">
      <body data-studio-preview={studioPreview ? "true" : undefined} data-studio-motion={studioMotion ? "true" : undefined}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <ActionGuidance />
        <RequiredFieldGuidance />
        {studioPreview && <StudioPreviewFeedback />}
      </body>
    </html>
  );
}
