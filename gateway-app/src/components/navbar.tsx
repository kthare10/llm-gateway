"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/logo";
import { getMe } from "@/services/gateway-api-service";

export default function Navbar() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => {
        setLoggedIn(true);
        setIsAdmin(me.is_admin);
      })
      .catch(() => {
        // not authenticated — keep defaults
      });
  }, []);

  return (
    <nav className="border-b bg-white">
      <div className="container mx-auto flex h-14 items-center px-4 gap-6">
        <a href="/" className="flex items-center gap-2 text-lg font-semibold text-primary">
          <Logo size={24} />
          LLM Gateway
        </a>
        {loggedIn && (
          <>
            <a href="/keys" className="text-sm text-muted-foreground hover:text-foreground">
              API Keys
            </a>
            {isAdmin && (
              <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
                Admin
              </a>
            )}
            <div className="ml-auto">
              <a href="/logout" className="text-sm text-muted-foreground hover:text-foreground">
                Logout
              </a>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
