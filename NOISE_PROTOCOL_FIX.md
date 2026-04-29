# Noise Protocol Frame Decoding Error — Diagnostic & Fix Guide

## The Problem

Production logs show a consistent pattern:

```
[Baileys] "msg":"connected to WA"                          ✓ WebSocket connects
[Baileys] "msg":"not logged in, attempting registration..." ✓ Registration starts
[5 seconds later]
Error: Connection Failure
    at Object.decodeFrame (noise-handler.js:140)          ✗ Frame decode FAILS
```

**What's happening:**
1. Baileys successfully connects to WhatsApp's WebSocket server
2. It sends the registration/pairing request
3. **WhatsApp responds with a Noise protocol frame**
4. **Baileys cannot parse/decode the frame** → Connection Failure

This suggests: **Baileys Noise protocol implementation doesn't match WhatsApp's current protocol version**

---

## Root Cause

WhatsApp uses the **Noise protocol** for encrypted communication. The frame decoder in Baileys expects a specific format:

- Frame structure
- Encryption parameters  
- Protocol version negotiation

If WhatsApp changed ANY of these recently, Baileys needs an update to handle it.

---

## Solution Progression

### **Step 1: Deploy Latest Baileys Version** (FIRST)

We've upgraded from 6.7.9 → 6.7.15 → **6.9.0**

The jump to 6.9.0 includes:
- Major Noise protocol improvements
- Better WhatsApp protocol compatibility
- Fixes for frame decoding issues

**Deploy and test with 6.9.0 first.**

### **Step 2: Try Alternative Browser Identifier** (IF 6.9.0 fails)

WhatsApp validates the browser type sent during registration. Some browser identifiers work better than others:

```bash
# In Render Environment Settings, add:
WHATSAPP_BROWSER_ID=Chrome      # Current (try first)
# If fails, try:
WHATSAPP_BROWSER_ID=Firefox     # Alternative 1
WHATSAPP_BROWSER_ID=Edge        # Alternative 2
WHATSAPP_BROWSER_ID=Safari      # Alternative 3
```

Each browser ID tells WhatsApp which device type is connecting. Some may have better compatibility.

### **Step 3: Check for WhatsApp Account Issues** (PARALLEL)

The error message says "WhatsApp recusou a conexão" (WhatsApp refused connection).

This could be because:

1. **Number is blocked/banned**
   - Try the same number on WhatsApp Web (https://web.whatsapp.com)
   - If Web fails too, WhatsApp may have banned the number
   - Solution: Use a different phone number

2. **Rate limited**
   - WhatsApp limits connection attempts
   - Error shows within 5 seconds → Noise protocol failure, not rate limit
   - But if it's "blocked", wait 24-48 hours before retrying

3. **Number format incorrect**
   - Must use international format: `+55 11 9 8765 4321` or `5511987654321`
   - No spaces or dashes in code

---

## Diagnostic Checklist

### ✓ **Step 1: Verify Number Format**
```
Correct:   +5511987654321  or  5511987654321
Wrong:     11987654321  (missing country code)
Wrong:     +55 11 98765-4321  (has spaces/dashes)
```

### ✓ **Step 2: Test on Web.WhatsApp.com**
1. Go to https://web.whatsapp.com
2. Scan with the same phone number
3. If Web.WhatsApp fails → WhatsApp has issues with this number
4. If Web.WhatsApp succeeds → Issue is Baileys-specific

### ✓ **Step 3: Check Render Logs for Specific Error**
```
Look for these patterns in logs:
- "Frame decode error" → Noise protocol issue (likely)
- "Invalid frame format" → Protocol mismatch (likely)
- "Authentication failed" → WhatsApp rejected (rate limit/ban)
- "Connection refused" → Network/firewall issue (unlikely)
```

### ✓ **Step 4: Try Different Browser ID**
1. Go to Render Dashboard
2. zapscript-api → Environment → Add `WHATSAPP_BROWSER_ID=Firefox`
3. Trigger redeploy
4. Test pairing code again
5. Check logs for result

---

## What to Do Now

### **Immediate Steps** (in this order):

1. **Deploy current changes** (Baileys 6.9.0 + browser config)
   ```bash
   git pull origin master  # Get latest code
   # Render auto-deploys on commit
   ```

2. **Wait for Render deployment to complete**
   - Check Render Dashboard → Deployments
   - Should show "Deployment successful"

3. **Test QR Code Generation**
   - Dashboard → Números → "+ Adicionar número"
   - Click "Conectar por QR Code"
   - Should show QR within 10 seconds
   - Scan with WhatsApp

4. **Test Pairing Code Generation**
   - Use valid phone number: `+5511987654321` (Brazil example)
   - Click "Conectar por Número"
   - Should show 8-char code within 10 seconds

5. **If Pairing Code Still Fails**
   - Check Render logs for error message
   - Note the exact error
   - Try Alternative Browser ID:
     ```
     Environment: WHATSAPP_BROWSER_ID=Firefox
     Redeploy and test again
     ```

---

## Expected Behavior After Fix

✅ **QR Code** appears in 5-10 seconds (or times out after 90s)
✅ **Pairing Code** appears in 5-10 seconds (or times out after 45s)
✅ **Logs show** either success OR clear error (not frame decode error)
✅ **Frame decode error** should NOT appear

---

## If Problem Persists After 6.9.0 + Browser ID Changes

### Escalation Path:

1. **Collect detailed logs** from Render
   - Copy entire error trace (the long stack trace)
   - Copy last 100 lines of logs around the failure

2. **Check GitHub Issues**
   - Go to: https://github.com/WhiskeySockets/Baileys/issues
   - Search for "Connection Failure" or "decodeFrame"
   - See if others have this issue and solutions

3. **Alternative Solutions to Investigate**
   - Use WhatsApp Business API (official, but more complex)
   - Try older Baileys version (6.8.x) to see if it's a regression
   - Check if WhatsApp blocked Web Client access (forcing mobile-only)

---

## Known Workarounds

### **If Baileys keeps failing:**

**Workaround 1: Force New Session**
```bash
# Clear all session files and start fresh
rm -rf .sessions/*
# Then try pairing again
```

**Workaround 2: Try Baileys on Local Machine**
```bash
# If local works but Render fails → environment-specific issue
# Possible causes:
# - Render's network/firewall configuration
# - Different SSL/TLS version on Render
# - Render's IP is rate-limited by WhatsApp
```

**Workaround 3: Switch to Twilio WhatsApp**
```bash
# Official API (more expensive but reliable)
# Would require significant refactoring
```

---

## Environment Variables to Set (Render Dashboard)

```bash
# Required for Baileys to work
WHATSAPP_BROWSER_ID=Chrome        # Try Firefox or Edge if Chrome fails

# Already set (don't change):
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
# ... other vars
```

---

## Logs to Monitor After Deployment

### **Good signs** (appears in logs):
```
[WhatsApp] Socket criado para {numberId}
[Baileys] "msg":"connected to WA"
[WhatsApp] QR emitido para number:{numberId}
```

### **Bad signs** (indicates problem):
```
Error: Connection Failure
Object.decodeFrame
[WhatsApp] Reconectando...
[WhatsApp] Conexão fechada...
```

---

## Next Steps

1. ✅ **Code is ready** — Baileys 6.9.0 deployed
2. ⏳ **Render is deploying** — Check dashboard for completion
3. 🧪 **Test the flows** — Try QR and Pairing Code
4. 📊 **Monitor logs** — Look for success or specific error
5. 🔧 **Adjust if needed** — Try different WHATSAPP_BROWSER_ID

---

**Last Updated**: 2026-04-29
**Latest Changes**: Baileys 6.9.0 + configurable browser ID + enhanced diagnostics
**Expected Result**: Connection Failure error should be resolved OR replaced with clear error message

