/**
 * Small set of presentational atoms shared between the home page and the
 * branch detail page. Server-Component compatible (no "use client").
 */

import type { CSSProperties, ReactNode } from "react";

export function SectionTitle({
  children,
  inline,
}: {
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <h2
      style={{
        fontSize: 14,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        color: "#a3a3a3",
        margin: inline ? 0 : "0 0 12px",
      }}
    >
      {children}
    </h2>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

export function Card({
  title,
  children,
  accent,
}: {
  title: string;
  children: ReactNode;
  accent?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #1f1f1f",
        background: "#111",
        borderRadius: 12,
        padding: 16,
        borderLeft: accent ? `3px solid ${accent}` : "1px solid #1f1f1f",
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "#737373",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "4px 0",
        fontSize: 13,
        borderBottom: "1px dashed #1f1f1f",
      }}
    >
      <span style={{ opacity: 0.6 }}>{k}</span>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {v}
      </span>
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <pre
      style={{
        marginTop: 12,
        padding: 10,
        background: "#2a0d0d",
        border: "1px solid #5c1a1a",
        borderRadius: 8,
        color: "#fca5a5",
        fontSize: 12,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </pre>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        border: "1px dashed #2a2a2a",
        borderRadius: 12,
        color: "#737373",
        fontSize: 14,
      }}
    >
      {text}
    </div>
  );
}

export function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #1f1f1f",
        background: "#111",
        borderRadius: 12,
        padding: "12px 16px",
        minWidth: 110,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "#737373",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: color || "#ededed",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export const codeStyle: CSSProperties = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: 6,
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
};

export const inlineCodeStyle: CSSProperties = {
  padding: "1px 6px",
  borderRadius: 4,
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
};
