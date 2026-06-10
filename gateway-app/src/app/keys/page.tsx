"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  getKeys,
  getModels,
  createKey,
  deleteKey,
  type LLMKey,
  type CreateKeyResponse,
  type ModelInfo,
} from "@/services/gateway-api-service";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  }
}

function downloadJson(data: object, filename: string) {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename
  );
}

function downloadText(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: "text/plain" }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function KeysPage() {
  const [keys, setKeys] = useState<LLMKey[]>([]);
  const [createdKey, setCreatedKey] = useState<CreateKeyResponse | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyComment, setKeyComment] = useState("");
  const [keyDuration, setKeyDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("api-key");
  const [copyStates, setCopyStates] = useState<Record<string, boolean>>({});

  const fetchKeys = useCallback(async () => {
    try {
      const res = await getKeys();
      setKeys(Array.isArray(res.keys) ? res.keys : []);
    } catch (ex) {
      toast.error(ex instanceof Error ? ex.message : "Failed to load keys");
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    (async () => {
      try {
        const res = await getModels();
        setAvailableModels(res.models || []);
        setSelectedModels((res.models || []).map((m) => m.modelId));
      } catch {
        // models default to empty
      }
    })();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await createKey({
        name: keyName,
        comment: keyComment || undefined,
        duration_days: keyDuration ?? undefined,
        models: selectedModels.length > 0 ? selectedModels : undefined,
      });
      setCreatedKey(result);
      setCopyStates({});
      setActiveTab("api-key");
      fetchKeys();
      toast.success("API key created successfully.");
    } catch (ex) {
      toast.error(ex instanceof Error ? ex.message : "Failed to create key");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!confirm("Are you sure you want to delete this key? This cannot be undone.")) return;
    try {
      await deleteKey(keyId);
      toast.success("Key deleted.");
      fetchKeys();
    } catch (ex) {
      toast.error(ex instanceof Error ? ex.message : "Failed to delete key");
    }
  };

  const handleCopy = async (key: string, text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopyStates((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => setCopyStates((prev) => ({ ...prev, [key]: false })), 2000);
    }
  };

  const resetForm = () => {
    setCreatedKey(null);
    setKeyName("");
    setKeyComment("");
    setKeyDuration(null);
    setSelectedModels(availableModels.map((m) => m.modelId));
    setCopyStates({});
  };

  const modelsLabel =
    availableModels.length === 0
      ? "Loading..."
      : selectedModels.length === availableModels.length
        ? "All Models"
        : selectedModels.length === 0
          ? "None selected"
          : `${selectedModels.length} of ${availableModels.length} selected`;

  return (
    <div className="container mx-auto max-w-5xl py-8 px-4">
      <div className="rounded-lg border bg-blue-50 border-blue-200 p-4 mb-6">
        Manage your LLM API keys. Keys provide OpenAI-compatible access to the
        configured LLM backends.
      </div>

      {/* ---- Create Key Form ---- */}
      <h2 className="text-xl font-semibold mb-4">Create API Key</h2>
      <form onSubmit={handleCreate}>
        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-4">
            <label className="block text-sm font-medium mb-1" htmlFor="key-name">
              Key Name <span className="text-destructive">*</span>
            </label>
            <input
              id="key-name"
              type="text"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="e.g., my-notebook-key"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              required
            />
          </div>
          <div className="col-span-4">
            <label className="block text-sm font-medium mb-1" htmlFor="key-comment">
              Comment (optional)
            </label>
            <input
              id="key-comment"
              type="text"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="e.g., For Jupyter notebook"
              value={keyComment}
              onChange={(e) => setKeyComment(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1" htmlFor="key-duration">
              Duration
            </label>
            <select
              id="key-duration"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={keyDuration ?? "never"}
              onChange={(e) => setKeyDuration(e.target.value === "never" ? null : parseInt(e.target.value))}
            >
              <option value="never">Never</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4 items-end mt-3">
          <div className="col-span-8">
            <label className="block text-sm font-medium mb-1">Models</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelsOpen((p) => !p)}
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className={selectedModels.length === 0 ? "text-muted-foreground" : ""}>
                  {modelsLabel}
                </span>
                <svg className="h-4 w-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {modelsOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
                  <div className="flex flex-col gap-0.5 p-2 max-h-48 overflow-y-auto">
                    <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={selectedModels.length === availableModels.length && availableModels.length > 0}
                        onChange={(e) =>
                          setSelectedModels(
                            e.target.checked ? availableModels.map((m) => m.modelId) : []
                          )
                        }
                      />
                      <span className="font-medium">Select All</span>
                    </label>
                    <div className="border-t my-0.5" />
                    {availableModels.map((m) => (
                      <label key={m.modelId} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-accent">
                        <input
                          type="checkbox"
                          checked={selectedModels.includes(m.modelId)}
                          onChange={(e) =>
                            setSelectedModels((prev) =>
                              e.target.checked
                                ? [...prev, m.modelId]
                                : prev.filter((id) => id !== m.modelId)
                            )
                          }
                        />
                        <span className="flex items-center gap-1.5">
                          {m.modelId}
                          {m.mode === "image_generation" && (
                            <span className="inline-flex items-center rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                              image
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col-span-4 flex justify-end">
            <button
              type="submit"
              disabled={loading || !!createdKey || !keyName.trim() || selectedModels.length === 0}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? "Creating..." : "Create Key"}
            </button>
          </div>
        </div>
      </form>

      {modelsOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setModelsOpen(false)} />
      )}

      {/* ---- Created Key Display ---- */}
      {createdKey && (
        <div className="mt-6">
          <div className="flex gap-1 border-b">
            {[
              "api-key",
              "chatbox",
              "claude-code",
              "codex",
              "opencode",
              "curl",
              "python",
              ...(createdKey.config_snippets.openai_python_image ? ["image-python"] : []),
            ].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "api-key" ? "API Key" : tab === "chatbox" ? "Chatbox" : tab === "claude-code" ? "Claude Code" : tab === "codex" ? "Codex" : tab === "opencode" ? "OpenCode" : tab === "curl" ? "curl" : tab === "python" ? "Python" : "Image (Python)"}
              </button>
            ))}
          </div>

          <div className="border border-t-0 rounded-b-lg p-4">
            {activeTab === "api-key" && (
              <div>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleCopy("apikey", createdKey.api_key)}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    {copyStates["apikey"] ? "Copied!" : "Copy API Key"}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={createdKey.api_key}
                  rows={2}
                  className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono"
                />
              </div>
            )}

            {activeTab === "chatbox" && (
              <div>
                {createdKey.config_snippets.chatbox_image ? (
                  <div className="grid grid-cols-2 gap-4">
                    {/* Chat Models pane */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Chat Models</h4>
                      <div className="flex gap-2 mb-2">
                        <button
                          onClick={() => handleCopy("chatbox-chat", JSON.stringify(createdKey.config_snippets.chatbox, null, 2))}
                          className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium hover:bg-accent"
                        >
                          {copyStates["chatbox-chat"] ? "Copied!" : "Copy"}
                        </button>
                        <button
                          onClick={() => downloadJson(createdKey.config_snippets.chatbox, "chatbox-llm-gateway-chat.json")}
                          className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium hover:bg-accent"
                        >
                          Download
                        </button>
                      </div>
                      <textarea
                        readOnly
                        value={JSON.stringify(createdKey.config_snippets.chatbox, null, 2)}
                        rows={14}
                        className="w-full rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    {/* Image Models pane */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">
                        Image Models
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                          image
                        </span>
                      </h4>
                      <div className="flex gap-2 mb-2">
                        <button
                          onClick={() => handleCopy("chatbox-image", JSON.stringify(createdKey.config_snippets.chatbox_image, null, 2))}
                          className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium hover:bg-accent"
                        >
                          {copyStates["chatbox-image"] ? "Copied!" : "Copy"}
                        </button>
                        <button
                          onClick={() => downloadJson(createdKey.config_snippets.chatbox_image!, "chatbox-llm-gateway-image.json")}
                          className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium hover:bg-accent"
                        >
                          Download
                        </button>
                      </div>
                      <textarea
                        readOnly
                        value={JSON.stringify(createdKey.config_snippets.chatbox_image, null, 2)}
                        rows={14}
                        className="w-full rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => handleCopy("chatbox", JSON.stringify(createdKey.config_snippets.chatbox, null, 2))}
                        className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                      >
                        {copyStates["chatbox"] ? "Copied!" : "Copy Config"}
                      </button>
                      <button
                        onClick={() => downloadJson(createdKey.config_snippets.chatbox, "chatbox-llm-gateway.json")}
                        className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                      >
                        Download JSON
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={JSON.stringify(createdKey.config_snippets.chatbox, null, 2)}
                      rows={12}
                      className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono"
                    />
                  </>
                )}
                <p className="mt-2 text-sm text-muted-foreground">
                  Import this configuration into Chatbox to connect to the LLM Gateway.
                </p>
              </div>
            )}

            {activeTab === "claude-code" && (
              <div>
                {createdKey.image_models.length > 0 && (
                  <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 mb-3 text-sm">
                    Image generation models ({createdKey.image_models.join(", ")}) are excluded from this config.{" "}
                    <button onClick={() => setActiveTab("image-python")} className="text-purple-700 underline font-medium">
                      View Image (Python) snippet
                    </button>
                  </div>
                )}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleCopy("claude", JSON.stringify(createdKey.config_snippets.claude_code, null, 2))}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    {copyStates["claude"] ? "Copied!" : "Copy Config"}
                  </button>
                  <button
                    onClick={() => downloadJson(createdKey.config_snippets.claude_code, "llm-gateway-settings.json")}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    Download JSON
                  </button>
                </div>
                <textarea
                  readOnly
                  value={JSON.stringify(createdKey.config_snippets.claude_code, null, 2)}
                  rows={10}
                  className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono"
                />
                <p className="mt-2 text-sm text-muted-foreground">
                  Save to <code className="bg-muted px-1 rounded">~/.claude/settings.json</code> and
                  run <code className="bg-muted px-1 rounded">claude --settings ~/.claude/settings.json</code>
                </p>
              </div>
            )}

            {activeTab === "codex" && (
              <div>
                {createdKey.image_models.length > 0 && (
                  <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 mb-3 text-sm">
                    Image generation models ({createdKey.image_models.join(", ")}) are excluded from this config.{" "}
                    <button onClick={() => setActiveTab("image-python")} className="text-purple-700 underline font-medium">
                      View Image (Python) snippet
                    </button>
                  </div>
                )}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleCopy("codex", createdKey.config_snippets.codex)}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    {copyStates["codex"] ? "Copied!" : "Copy Config"}
                  </button>
                  <button
                    onClick={() => downloadText(createdKey.config_snippets.codex, "config.toml")}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    Download TOML
                  </button>
                </div>
                <textarea
                  readOnly
                  value={createdKey.config_snippets.codex}
                  rows={10}
                  className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono"
                />
                <p className="mt-2 text-sm text-muted-foreground">
                  Save to <code className="bg-muted px-1 rounded">~/.codex/config.toml</code> (or merge
                  into your existing file), then run <code className="bg-muted px-1 rounded">codex</code>.
                </p>
              </div>
            )}

            {activeTab === "opencode" && (
              <div>
                {createdKey.image_models.length > 0 && (
                  <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 mb-3 text-sm">
                    Image generation models ({createdKey.image_models.join(", ")}) are excluded from this config.{" "}
                    <button onClick={() => setActiveTab("image-python")} className="text-purple-700 underline font-medium">
                      View Image (Python) snippet
                    </button>
                  </div>
                )}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleCopy("opencode", JSON.stringify(createdKey.config_snippets.opencode, null, 2))}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    {copyStates["opencode"] ? "Copied!" : "Copy Config"}
                  </button>
                  <button
                    onClick={() => downloadJson(createdKey.config_snippets.opencode, "opencode.json")}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    Download JSON
                  </button>
                </div>
                <textarea
                  readOnly
                  value={JSON.stringify(createdKey.config_snippets.opencode, null, 2)}
                  rows={12}
                  className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono"
                />
                <p className="mt-2 text-sm text-muted-foreground">
                  Save to <code className="bg-muted px-1 rounded">opencode.json</code> in your project root.
                  Run <code className="bg-muted px-1 rounded">opencode /connect</code> to add the API key, then select <code className="bg-muted px-1 rounded">llm-gateway</code> as the provider.
                </p>
              </div>
            )}

            {activeTab === "curl" && (
              <div>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleCopy("curl", createdKey.config_snippets.curl)}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    {copyStates["curl"] ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                  {createdKey.config_snippets.curl}
                </pre>
              </div>
            )}

            {activeTab === "python" && (
              <div>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleCopy("python", createdKey.config_snippets.openai_python)}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    {copyStates["python"] ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                  {createdKey.config_snippets.openai_python}
                </pre>
              </div>
            )}

            {activeTab === "image-python" && createdKey.config_snippets.openai_python_image && (
              <div>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleCopy("image-python", createdKey.config_snippets.openai_python_image!)}
                    className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
                  >
                    {copyStates["image-python"] ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                  {createdKey.config_snippets.openai_python_image}
                </pre>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use this snippet with image generation models via the <code className="bg-muted px-1 rounded">images.generate()</code> API.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4 mt-3">
            <span className="text-sm">Save this API key now. It will not be shown again.</span>
            <button
              onClick={resetForm}
              className="inline-flex h-8 items-center rounded-md border border-primary text-primary px-3 text-xs font-medium hover:bg-primary/5"
            >
              Create Another Key
            </button>
          </div>
        </div>
      )}

      {/* ---- Keys Listing ---- */}
      <h2 className="text-xl font-semibold mt-8 mb-4">Your API Keys</h2>
      {keys.length > 0 ? (
        <div className="rounded-md border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Key ID</th>
                <th className="px-4 py-3 text-left font-medium">Spend</th>
                <th className="px-4 py-3 text-left font-medium">Budget</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-left font-medium">Expires</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key, i) => (
                <tr key={i} className="border-b">
                  <td className="px-4 py-3">{key.key_alias || key.key_name || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{key.token || "-"}</td>
                  <td className="px-4 py-3">
                    {key.spend != null ? `$${parseFloat(String(key.spend)).toFixed(4)}` : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {key.max_budget != null ? `$${parseFloat(String(key.max_budget)).toFixed(2)}` : "Unlimited"}
                  </td>
                  <td className="px-4 py-3">
                    {key.created_at ? new Date(key.created_at).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {key.expires ? new Date(key.expires).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(key.token || "")}
                      className="inline-flex h-8 items-center rounded-md border border-destructive text-destructive px-3 text-xs font-medium hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border bg-blue-50 border-blue-200 p-4">
          No API keys found. Create one above to get started.
        </div>
      )}
    </div>
  );
}
