"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { getMe, getAdminUsers, getAdminUsage } from "@/services/gateway-api-service";

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<Record<string, unknown>[]>([]);
  const [usage, setUsage] = useState<Record<string, unknown>>({});

  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        setIsAdmin(me.is_admin);
        if (!me.is_admin) return;

        const [usersRes, usageRes] = await Promise.all([
          getAdminUsers(),
          getAdminUsage(),
        ]);
        setUsers(usersRes.users as Record<string, unknown>[]);
        setUsage(usageRes);
      } catch (ex) {
        toast.error(ex instanceof Error ? ex.message : "Failed to load admin data");
      }
    })();
  }, []);

  if (isAdmin === null) {
    return (
      <div className="container mx-auto max-w-5xl py-8 px-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-5xl py-8 px-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          You do not have admin access. Contact an administrator if you believe this is an error.
        </div>
      </div>
    );
  }

  const totalSpend = typeof usage.total_spend === "number" ? usage.total_spend : 0;

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <h2 className="text-xl font-semibold mb-6">Admin Dashboard</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Total Users</p>
          <p className="text-2xl font-semibold">{users.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Total Spend</p>
          <p className="text-2xl font-semibold">${totalSpend.toFixed(4)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Status</p>
          <p className="text-2xl font-semibold text-green-600">Active</p>
        </div>
      </div>

      {/* Users Table */}
      <h3 className="text-lg font-medium mb-3">Users</h3>
      {users.length > 0 ? (
        <div className="rounded-md border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">User ID</th>
                <th className="px-4 py-3 text-left font-medium">Email</th>
                <th className="px-4 py-3 text-left font-medium">Spend</th>
                <th className="px-4 py-3 text-left font-medium">Max Budget</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={i} className="border-b">
                  <td className="px-4 py-3 font-mono text-xs">
                    {String(u.user_id || "-")}
                  </td>
                  <td className="px-4 py-3">{String(u.user_email || u.user_id || "-")}</td>
                  <td className="px-4 py-3">
                    {typeof u.spend === "number" ? `$${u.spend.toFixed(4)}` : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {typeof u.max_budget === "number" ? `$${u.max_budget.toFixed(2)}` : "Unlimited"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border bg-blue-50 border-blue-200 p-4">
          No users found.
        </div>
      )}
    </div>
  );
}
