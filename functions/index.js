const {
  onDocumentCreated,
  onDocumentDeleted,
} = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

/**
 * Collects every crew member's push token (stored on their user doc as
 * fcmToken) so we can notify the whole board at once. Simple broadcast —
 * fine for a small crew. Skips the person who triggered the change.
 */
async function getTokens(excludeUid) {
  const snap = await db.collection("users").get();
  const tokens = [];
  snap.forEach((doc) => {
    if (doc.id === excludeUid) return;
    const token = doc.data().fcmToken;
    if (token) tokens.push(token);
  });
  return tokens;
}

async function sendToTokens(tokens, title, body) {
  if (tokens.length === 0) return;
  await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    apns: { payload: { aps: { sound: "default" } } },
  });
}

// One-line summary of a shift, shared by the posted/removed notifications
function shiftLine(shift) {
  return `${shift.employeeName} — ${shift.day} ${shift.start}–${shift.end}`;
}

// Fires when a new shift is posted to the board
exports.onShiftCreated = onDocumentCreated("shifts/{shiftId}", async (event) => {
  const shift = event.data.data();
  const tokens = await getTokens(shift.createdBy);
  await sendToTokens(tokens, "New shift posted", shiftLine(shift));
});

// Fires when a shift is taken off the board. Firestore delete triggers don't
// carry the acting user, so this goes out to the whole crew — including
// whoever removed it.
exports.onShiftDeleted = onDocumentDeleted("shifts/{shiftId}", async (event) => {
  const shift = event.data.data();
  const tokens = await getTokens();
  await sendToTokens(tokens, "Shift removed", shiftLine(shift));
});

// Fires when a new to-do is added to the list
exports.onTodoCreated = onDocumentCreated("todos/{todoId}", async (event) => {
  const todo = event.data.data();
  const tokens = await getTokens(todo.createdBy);
  const dueNote = todo.dueDay ? ` (due ${todo.dueDay})` : "";
  await sendToTokens(tokens, "New task added", `${todo.text}${dueNote}`);
});
