// Reading a request body safely, for every api/ file that takes one.
//
// Locally, server.js already refuses bodies over 100 KB. On Vercel only
// Vercel's own 4.5 MB limit applies, so this sets the same 100 KB limit in
// the functions themselves (found in the Build 3 security review). A real
// check-in is under 2 KB.

export const MAX_BODY_BYTES = 100_000;

// Returns { body } with the parsed JSON, or { problem } with the response to send.
export async function readJson(request) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) return { problem: tooLarge() };

  let text;
  try {
    text = await request.text();
  } catch {
    return { problem: unreadable() };
  }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { problem: tooLarge() };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { problem: unreadable() };
  }
}

const tooLarge = () => Response.json({ error: 'That request is too large.' }, { status: 413 });
const unreadable = () => Response.json({ error: 'Could not read the request.' }, { status: 400 });
