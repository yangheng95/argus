// ── Interaction → synthetic message pipeline ──
//
// An interaction (permission / question / clarification) is a prompt the
// backend raised from inside a specific session. The overlay renders it as
// part of the conversation timeline by materialising it as one or more
// synthetic `Message` objects that flow through the same CardParts renderer
// as regular messages.
//
// The routing rule: an interaction whose `sessionID` matches a known agent
// card is "claimed" by that card; interactions without a sessionID (or whose
// session has no card yet) are returned as "unclaimed" so the caller can
// surface them separately.
//
// tree-writer and the message store both consume this module so that both
// paths agree on what "claimed" means and on the synthetic-message shape.

import {
  syntheticTextMessage,
  interactionRequestText,
  interactionResponseText,
  isAutoReplied,
} from "./transcript";

/** Convert one interaction into the synthetic `Message`(s) that render it.
 *
 *  - Pending permission/question → a single message carrying an
 *    `interaction-*` part so <CardParts> dispatches to <InteractionCard>.
 *  - Answered/rejected → a request-text bubble plus a response-text bubble
 *    (the transcript path — the interactive card is no longer needed).
 *  - Auto-replied permissions are filtered (they carry no user-visible
 *    signal and clutter the timeline).
 *  - Pending interactions of other types (no `interaction-*` part) fall
 *    through to the transcript path with just a request bubble.
 *
 *  Returns [] when the interaction is filtered; callers should treat that
 *  as "render nothing for this one". */
export function interactionToSyntheticMessages(interaction: any): any[] {
  const isAutoPermission =
    interaction?.type === "permission" &&
    (interaction.status === "answered" || interaction.status === "rejected") &&
    isAutoReplied(interaction);
  if (isAutoPermission) return [];

  const role = "system";
  const requestTime = Number(interaction?.time?.created);

  if (interaction?.status === "pending") {
    const partType =
      interaction.type === "question"
        ? "interaction-question"
        : interaction.type === "permission"
          ? "interaction-permission"
          : null;
    if (partType) {
      return [
        {
          _synthetic: true,
          info: {
            id: `ctx:interaction:${interaction.id}`,
            role,
            resolvedRole: role,
            channel: "main",
            time: { created: requestTime },
          },
          parts: [{ type: partType, interaction }],
        },
      ];
    }
  }

  const msgs: any[] = [];
  const request = syntheticTextMessage(
    role,
    requestTime,
    interactionRequestText(interaction),
  );
  if (request) msgs.push(request);
  if (interaction?.status === "answered" || interaction?.status === "rejected") {
    const resolvedTime = Number(interaction.time?.resolved);
    const response = syntheticTextMessage(
      role,
      resolvedTime,
      interactionResponseText(interaction),
    );
    if (response) msgs.push(response);
  }
  return msgs;
}

/** Split a list of interactions into per-session buckets (for interactions
 *  whose `sessionID` is a known agent session) and an orphan list for the
 *  rest. `knownSessionIDs` is typically `Object.keys(messagesBySession)`. */
export function partitionInteractions(
  interactions: any[] | null | undefined,
  knownSessionIDs: ReadonlySet<string>,
): { bySession: Map<string, any[]>; orphan: any[] } {
  const bySession = new Map<string, any[]>();
  const orphan: any[] = [];
  if (!Array.isArray(interactions)) return { bySession, orphan };
  for (const it of interactions) {
    const sid = typeof it?.sessionID === "string" ? it.sessionID : "";
    if (sid && knownSessionIDs.has(sid)) {
      const list = bySession.get(sid);
      if (list) list.push(it);
      else bySession.set(sid, [it]);
    } else {
      orphan.push(it);
    }
  }
  return { bySession, orphan };
}
