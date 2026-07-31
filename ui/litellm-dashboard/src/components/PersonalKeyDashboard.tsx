"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import MessageManager from "@/components/molecules/message_manager";
import { getGlobalLitellmHeaderName, getProxyBaseUrl } from "@/components/networking";
import { ApiError, createApiClient } from "@/lib/http/client";
import type { HttpMethod } from "@/lib/http/client";
import { useEffect, useState } from "react";

type PersonalKey = {
  logical_key_id: string;
  key_alias: string | null;
  user_id: string;
  team_id: string;
  organization_id: string;
  generation: number;
  status: "active" | "blocked" | "expired";
  expires: string;
};

type PersonalKeySecret = PersonalKey & {
  key: string;
  previous_key_revoke_at?: string;
};

type PersonalKeyDashboardProps = {
  accessToken: string;
};

const personalKeyClient = createApiClient({
  getBaseUrl: getProxyBaseUrl,
  getAuthHeaderName: getGlobalLitellmHeaderName,
});

async function personalKeyRequest<T>(accessToken: string, path: string, method: HttpMethod, body?: object): Promise<T> {
  return personalKeyClient.request<T>(method, path, { accessToken, body });
}

export default function PersonalKeyDashboard({ accessToken }: PersonalKeyDashboardProps) {
  const [keyInfo, setKeyInfo] = useState<PersonalKey | null>(null);
  const [keyAlias, setKeyAlias] = useState("");
  const [newSecret, setNewSecret] = useState<PersonalKeySecret | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await personalKeyRequest<PersonalKey>(accessToken, "/internal/personal-key", "GET");
        if (active) {
          setKeyInfo(result);
        }
      } catch (error) {
        if (active && error instanceof ApiError && error.status === 404) {
          setKeyInfo(null);
        } else if (active) {
          MessageManager.fromBackend(error);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [accessToken]);

  const create = async () => {
    setLoading(true);
    try {
      const created = await personalKeyRequest<PersonalKeySecret>(accessToken, "/internal/personal-key", "POST", {
        key_alias: keyAlias.trim() || null,
      });
      setKeyInfo(created);
      setNewSecret(created);
      MessageManager.success("Personal key created");
    } catch (error) {
      MessageManager.fromBackend(error);
    } finally {
      setLoading(false);
    }
  };

  const rotate = async () => {
    setLoading(true);
    try {
      const rotated = await personalKeyRequest<PersonalKeySecret>(accessToken, "/internal/personal-key/rotate", "POST");
      setKeyInfo(rotated);
      setNewSecret(rotated);
      MessageManager.success("Personal key rotated");
    } catch (error) {
      MessageManager.fromBackend(error);
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete and immediately block this personal key?")) {
      return;
    }
    setLoading(true);
    try {
      await personalKeyRequest(accessToken, "/internal/personal-key", "DELETE");
      setKeyInfo(null);
      setNewSecret(null);
      MessageManager.success("Personal key deleted");
    } catch (error) {
      MessageManager.fromBackend(error);
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    if (newSecret === null) {
      return;
    }
    await navigator.clipboard.writeText(newSecret.key);
    MessageManager.success("Key copied");
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <Card>
        <CardHeader>
          <CardTitle>Personal API key</CardTitle>
          <CardDescription>
            Your department controls model and MCP access. The key lifetime and shared Human quota are managed by the
            gateway.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {newSecret !== null && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="mb-2 font-medium">Copy this key now. It will not be shown again.</p>
              <div className="flex gap-2">
                <Input readOnly value={newSecret.key} className="font-mono" />
                <Button onClick={copySecret}>Copy</Button>
              </div>
              {newSecret.previous_key_revoke_at && (
                <p className="mt-2 text-sm text-muted-foreground">
                  The previous key works until {new Date(newSecret.previous_key_revoke_at).toLocaleString()}.
                </p>
              )}
            </div>
          )}
          {keyInfo === null ? (
            <div className="space-y-3">
              <Input
                value={keyAlias}
                onChange={(event) => setKeyAlias(event.target.value)}
                placeholder="Optional key alias"
                maxLength={255}
              />
              <p className="text-sm text-muted-foreground">You can have one active personal key.</p>
            </div>
          ) : (
            <dl className="grid grid-cols-[10rem_1fr] gap-3 text-sm">
              <dt className="text-muted-foreground">Alias</dt>
              <dd>{keyInfo.key_alias || "Personal key"}</dd>
              <dt className="text-muted-foreground">Department Team</dt>
              <dd>{keyInfo.team_id}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{keyInfo.status}</dd>
              <dt className="text-muted-foreground">Generation</dt>
              <dd>{keyInfo.generation}</dd>
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{new Date(keyInfo.expires).toLocaleString()}</dd>
            </dl>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          {keyInfo === null ? (
            <Button disabled={loading} onClick={create}>
              Create personal key
            </Button>
          ) : (
            <>
              <Button disabled={loading} onClick={rotate}>
                Rotate
              </Button>
              <Button disabled={loading} variant="destructive" onClick={remove}>
                Delete
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
