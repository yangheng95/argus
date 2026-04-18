import { createResource, Show, Switch, Match } from "solid-js";
import { fetchResourceAsObjectUrl, peekResourceObjectUrl, resolveResourceUrl } from "../services/api";

// Render a message "file" part: server-persisted attachments carry a URL that
// is either a server-relative path (/attachment/<projectID>/<sha>.<ext>) or
// an inline data URL (the composer's preview bubble before the task is
// submitted). Dropping server-relative paths into <img src> directly breaks
// under Tauri (wrong origin) and under Basic Auth (<img> cannot carry
// Authorization). This component routes through services/api so the same
// path works for every deployment:
//   - data: / blob: / http(s): URLs → used verbatim for <img src>
//   - "/..." relative URLs for images → fetched via fetch() (origin + auth
//     handled centrally), converted to a blob object URL owned by the
//     module-level cache in services/api (see fetchResourceAsObjectUrl)
//   - non-image file parts → rendered as a filename label
//
// Failures are surfaced, not papered over: a fetch error prints to console
// and replaces the image with a "Failed to load" chip. No fallback to the
// raw URL, since that would mask the underlying origin/auth mistake.

function isImage(part: { url?: string; mime?: string; mediaType?: string }): boolean {
  const mime = part.mime || part.mediaType || "";
  if (mime && mime.startsWith("image/")) return true;
  const url = part.url || "";
  if (/^data:image\//i.test(url)) return true;
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(url);
}

function needsAuthedFetch(url: string): boolean {
  // data: and blob: URLs are already bytes; absolute http(s) URLs owned by
  // third parties shouldn't receive our auth header. Only server-relative
  // paths (those `resolveResourceUrl` rewrites onto our serverUrl) need the
  // fetch → objectURL dance to carry Authorization / cross-origin.
  return url.startsWith("/");
}

export function FilePart(props: {
  part: { type: "file"; url?: string; mime?: string; mediaType?: string; filename?: string };
}) {
  const url = () => props.part.url || "";
  const name = () => props.part.filename || url() || "file";

  return (
    <Switch>
      <Match when={isImage(props.part) && url() && needsAuthedFetch(url())}>
        <AuthedImage url={url()} alt={name()} />
      </Match>
      <Match when={isImage(props.part) && url()}>
        <div class="msg-img-wrap">
          <img class="md-img" src={resolveResourceUrl(url())} alt={name()} loading="lazy" />
        </div>
      </Match>
      <Match when={true}>
        <div
          class="msg-text"
          style="font-family:var(--mono);font-size:var(--ui-font-small);color:var(--text-soft)"
        >
          {name()}
        </div>
      </Match>
    </Switch>
  );
}

function AuthedImage(props: { url: string; alt: string }) {
  // Blob lifetime is owned by the module-level cache in services/api —
  // remounts do not revoke URLs, so this component no longer needs an
  // onCleanup or a prev→next revoke effect.
  //
  // `initialValue` is a synchronous peek into that cache: when the raw URL
  // has already been materialised, the resource signal ships with the
  // resolved blob URL on its very first read, so the <Show> gate below
  // stays open across mount. The fetcher still runs (createResource always
  // calls it) but a cache-hit path inside `fetchResourceAsObjectUrl`
  // resolves immediately without touching the network.
  const [objectUrl] = createResource(() => props.url, fetchResourceAsObjectUrl, {
    initialValue: peekResourceObjectUrl(props.url),
  });

  return (
    <Show
      when={!objectUrl.error}
      fallback={
        <div
          class="msg-text"
          style="font-family:var(--mono);font-size:var(--ui-font-small);color:var(--text-warn,#c66)"
        >
          {`Failed to load ${props.alt}`}
        </div>
      }
    >
      <Show when={objectUrl()}>
        {(resolved) => (
          <div class="msg-img-wrap">
            <img class="md-img" src={resolved()} alt={props.alt} loading="lazy" />
          </div>
        )}
      </Show>
    </Show>
  );
}
