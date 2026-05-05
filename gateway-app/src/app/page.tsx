"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/logo";
import { getMe } from "@/services/gateway-api-service";

const features = [
  {
    title: "Key Management",
    description:
      "Create, rotate, and revoke API keys through a simple self-service interface. Stay in control of who can access your models.",
    icon: (
      <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
      </svg>
    ),
  },
  {
    title: "Multi-Model Access",
    description:
      "Route requests to OpenAI, Anthropic, Google, and more through a single unified endpoint powered by LiteLLM.",
    icon: (
      <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    title: "Usage Tracking",
    description:
      "Monitor token consumption, request counts, and costs per key. Administrators can view usage across the entire organization.",
    icon: (
      <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
];

export default function Home() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    getMe()
      .then(() => setLoggedIn(true))
      .catch(() => setLoggedIn(false));
  }, []);

  return (
    <div className="container mx-auto px-4 py-16">
      {/* Hero */}
      <div className="flex flex-col items-center text-center mb-16">
        <div className="text-primary mb-6">
          <Logo size={80} />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          LLM Gateway
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          A unified, self-service gateway for managing API keys and routing
          requests across multiple large-language-model providers.
        </p>
        {loggedIn === false && (
          <a
            href="/keys"
            className="mt-8 inline-flex items-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white shadow hover:bg-primary/90 transition-colors"
          >
            Login
          </a>
        )}
        {loggedIn === true && (
          <a
            href="/keys"
            className="mt-8 inline-flex items-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white shadow hover:bg-primary/90 transition-colors"
          >
            Go to Dashboard
          </a>
        )}
      </div>

      {/* Feature cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-lg border bg-white p-6 shadow-sm"
          >
            <div className="mb-4">{f.icon}</div>
            <h2 className="text-lg font-semibold text-foreground">{f.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {f.description}
            </p>
          </div>
        ))}
      </div>

      {/* Footer line */}
      <p className="mt-16 text-center text-sm text-muted-foreground">
        Powered by LiteLLM &mdash; proxy, manage, and observe all your LLM API
        calls in one place.
      </p>
    </div>
  );
}
