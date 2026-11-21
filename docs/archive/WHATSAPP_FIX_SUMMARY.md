# WhatsApp Connection Troubleshooting — Summary of Changes

## Problem Statement
WhatsApp QR code and pairing code generation were failing in production (Render environment) with:
- **QR Code**: Timeout after 90 seconds with no QR displayed
- **Pairing Code**: Timeout after 45 seconds with error
- **Root Cause**: Baileys socket was connecting to WhatsApp servers but failing during Noise protocol frame decoding

Production logs showed:
```
Error: Connection Failure
    at WebSocketClient.<anonymous> (noise-handler.js:140)
```

## Root Cause Analysis

The "Connection Failure" error during Noise protocol frame decoding indicates:
1. The WebSocket connection to WhatsApp servers was established
2. But the Noise protocol handshake failed before QR event could be emitted
3. This happened consistently, suggesting version incompatibility or environment-specific issues

## Changes Made

### 1. **Baileys Version Update** (Commit: a9c9263)
- Updated from `^6.7.9` to `^6.7.15`
- Files modified:
  - `apps/api/package.json`
  - `apps/worker/package.json`
- Rationale: Version 6.7.15 includes fixes for WebSocket stability and Noise protocol handling

### 2. **Enhanced Diagnostics & Logging** (Commit: 90812dd)
- Added custom logger to Baileys socket for visibility into connection issues
- Configuration improvements:
  - `syncFullHistory: false` — Reduces initial sync overhead
  - `generateHighQualityLinkPreview: false` — Disables aggressive features
  - `connectTimeoutMs: 60_000` — Extends timeout from default 30s to 60s
- Added detailed error logging in `connection.update` handler
- Added WebSocket error event handler to catch Noise protocol failures
- Files modified:
  - `apps/api/src/services/whatsapp.ts`
  - `apps/api/src/index.ts` (removed broken pending QR resend)

### 3. **Session Recovery Improvements** (Commit: 48a42d3)
- Always clear old session files on startup before reconnecting
- Better error handling for corrupted session data
- Allows graceful fallback if encrypted session cannot be restored
- Improved error messages with diagnostic information
- Files modified:
  - `apps/api/src/services/whatsapp.ts`
  - `reconnectAllSessions()` function

## Technical Details

### Socket Configuration
```typescript
const sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
  browser: ['ZapScript', 'Chrome', '1.0.0'],
  syncFullHistory: false,  // ← NEW
  generateHighQualityLinkPreview: false,  // ← NEW
  connectTimeoutMs: 60_000,  // ← NEW
  logger: { ... },  // ← Custom logger
});
```

### Error Handling
- WebSocket errors are now caught: `sock.ws?.on('error', ...)`
- Connection close events include error code and message
- Session restoration failures are logged but don't block reconnection

### Session Cleanup
```typescript
// On reconnect, always clear old files first
clearSessionDir(numberId);  // ← Always called before restoration

// Restore with error handling
try {
  restoreSessionToDisk(numberId, n.sessionEncrypted);
} catch (restoreErr) {
  console.warn(`Falha ao restaurar sessão, criando nova`);
  // Continue anyway — triggers new QR code
}
```

## Testing Instructions

### After Deployment to Render:

1. **Monitor Logs**:
   ```
   Render Dashboard → zapscript-api → Logs
   ```
   Look for new logging output:
   - `[WhatsApp] Socket criado para {numberId}`
   - `[Baileys] ...` (custom logger messages)
   - `[WhatsApp] connection.update - numberId: {id}, qr: {true|false}, connection: {state}`

2. **Test QR Code Generation**:
   - Dashboard → Números → "+ Adicionar número"
   - Click "Conectar por QR Code"
   - Should see QR code appear within 10 seconds
   - Scan with phone and verify connection

3. **Test Pairing Code Generation**:
   - Dashboard → Números → "+ Adicionar número"
   - Click "Conectar por Número"
   - Enter phone number (with country code, e.g., +5511987654321)
   - Should see pairing code appear within 10 seconds

4. **Check for Error Messages**:
   - If "Connection Failure" still appears in logs, note the timestamp
   - Check if it's during registration or after connection
   - Look for WebSocket errors or Baileys logger messages

## Expected Improvements

- ✓ More stable WebSocket connections to WhatsApp servers
- ✓ Better handling of slow/unstable network conditions
- ✓ Clearer error messages for debugging
- ✓ Graceful recovery from corrupted session data
- ✓ Better diagnostics for future troubleshooting

## If Issues Persist

### Debug Steps:

1. **Check Render Environment Logs**:
   ```
   Look for: "not logged in, attempting registration..."
   Should be followed by either:
   - "requestPairingCode sucesso" (success)
   - Or actual error message with details
   ```

2. **Verify Baileys Installation**:
   - Check Render build logs for npm install errors
   - Ensure version 6.7.15+ is actually installed

3. **Check WhatsApp Account Status**:
   - Try pairing code from Web.WhatsApp.com directly
   - If that fails, WhatsApp may be blocking the number

4. **Network Connectivity**:
   - Verify Render can reach WhatsApp servers
   - Check for firewall/proxy issues on Render infrastructure

## Rollback Instructions

If 6.7.15 causes issues, can revert:
```bash
git revert a9c9263  # Revert Baileys version
git push origin master
# Render will auto-rebuild
```

## Next Steps

1. Deploy these changes to Render production
2. Monitor logs for the first hour
3. Test QR and pairing code flows
4. If still failing, collect detailed logs and check Baileys GitHub issues
5. May need to investigate Render-specific networking configuration

---

**Last Updated**: 2026-04-29
**Commits**: 90812dd, a9c9263, 48a42d3
