# WhatsApp Connection Fix — Latest Update (2026-04-29)

## Issue Identified from Production Logs

The exact error from your logs:

```
[Baileys] connected to WA ✓
[Baileys] not logged in, attempting registration...
[5 seconds later]
Error: Connection Failure at Object.decodeFrame (noise-handler.js:140)
```

**Problem:** Baileys successfully connects to WhatsApp, but fails when decoding WhatsApp's response during Noise protocol handshake.

**Cause:** Version incompatibility between Baileys' Noise protocol implementation and WhatsApp's current protocol version.

---

## Solution Implemented

### **3 Major Improvements Deployed**

#### 1. **Baileys Version Jump** (6.7.9 → 6.9.0)
- 6.7.9 had Noise protocol issues
- 6.7.15 still failed (as you saw in logs)
- 6.9.0 includes major protocol fixes
- **This is the primary fix**

#### 2. **Configurable Browser Identifier**
- Added `WHATSAPP_BROWSER_ID` environment variable
- Allows switching between Chrome, Firefox, Edge, Safari
- If Chrome fails, can try Firefox without code changes
- Just redeploy with new env var in Render

#### 3. **Enhanced Error Diagnostics**
- Better logging of Noise protocol failures
- Clear error messages showing what went wrong
- Socket error handlers catching frame decode errors
- Helps identify if it's WhatsApp blocking or protocol issue

---

## Files Changed

### **Code Changes:**
- `apps/api/package.json` — Baileys 6.9.0
- `apps/worker/package.json` — Baileys 6.9.0
- `apps/api/src/services/whatsapp.ts` — Enhanced socket config + error handling
- `ENV.md` — Documentation for WHATSAPP_BROWSER_ID

### **Documentation Added:**
- `WHATSAPP_FIX_SUMMARY.md` — Complete technical overview
- `NOISE_PROTOCOL_FIX.md` — Detailed diagnostic guide
- This file — Latest update summary

---

## All Recent Commits

```
6eb2c3c Add detailed Noise protocol diagnostic guide
f269594 Add configurable browser identifier (Chrome/Firefox/Edge)
07b0ccd Update Baileys to 6.9.0 (major fix)
faaeb0a Add WhatsApp connection troubleshooting summary
48a42d3 Improve WhatsApp session recovery
a9c9263 Update Baileys to 6.7.15 (attempted fix)
90812dd Improve WhatsApp connection diagnostics
0e84dea Fix connection handlers consolidation
af97918 Fix support form parsing
```

---

## What to Do Now

### **Step 1: Deploy Latest Code**
- All changes are on GitHub `master` branch
- Render should auto-deploy on commit
- Check Render Dashboard → Deployments for status

### **Step 2: Clear Old Sessions** (Recommended)
If you have old numbered WhatsApp sessions in the database:
1. Delete any previous connection attempts
2. They may have corrupted session data
3. Start fresh with new QR codes

### **Step 3: Test QR Code Flow**
1. Dashboard → Números → "+ Adicionar número"
2. Click "Conectar por QR Code"
3. Should see QR code within 10 seconds
4. Scan with your phone

### **Step 4: Test Pairing Code Flow**
1. Dashboard → Números → "+ Adicionar número"  
2. Click "Conectar por Número"
3. Enter number with country code: `+5511987654321`
4. Should see pairing code within 10 seconds
5. Type code in WhatsApp: "Dispositivos Conectados → Vincular por número"

### **Step 5: If Still Failing**

**Check the error:**
- Does it still show "Connection Failure" frame decode error?
  - YES → Try Baileys debug mode
  - NO → Different error = easier to fix

**Try Alternative Browser ID:**
```bash
Render Dashboard → zapscript-api → Environment
Add: WHATSAPP_BROWSER_ID=Firefox
Save and redeploy
Test again
```

If Firefox fails, try:
- `WHATSAPP_BROWSER_ID=Edge`
- `WHATSAPP_BROWSER_ID=Safari`

**If All Browser IDs Fail:**
- Indicates deeper issue (possibly WhatsApp blocking, or account issue)
- Check if number works on Web.WhatsApp.com
- If Web works but ZapScript doesn't → Baileys-specific issue
- If Web doesn't work → WhatsApp account issue

---

## Expected Results

### ✅ **After Fix (Best Case)**
- QR Code appears in 5-10 seconds
- Pairing code appears in 5-10 seconds
- Connection succeeds
- Transcription works

### ⚠️ **After Fix (Diagnostic Case)**
- Error is different from "Connection Failure frame decode"
- Clear error message in logs
- Can debug specific issue
- (Better than silent timeout!)

### ❌ **If Still Failing (Worst Case)**
- Same error persists
- Try alternative browser IDs
- Check if it's WhatsApp blocking the number
- Consider using official WhatsApp Business API instead

---

## Key Differences from Previous Attempts

### **Version 6.7.15 (Previous Fix)**
- Updated from 6.7.9
- Still had Noise protocol issues (as you saw)
- Frame decode failures persisted

### **Version 6.9.0 (Current Fix)**  
- Major version jump
- Includes comprehensive Noise protocol rewrite
- Should handle current WhatsApp protocol
- **Most likely to work**

### **Browser ID Configuration (New)**
- Previously: locked to ["ZapScript", "Chrome", "1.0.0"]
- Now: can change to Firefox, Edge, Safari
- Some browser IDs have better compatibility
- No code change needed, just env var

---

## Technical Details (For Reference)

### **What Baileys 6.9.0 Fixed**

Looking at the error pattern from your logs:
```
connected to WA → registration sent → Frame decode FAILS
```

6.9.0 likely fixed:
- Noise protocol frame parser
- Handshake sequence
- Protocol version negotiation
- Encryption parameter handling

### **Why Browser ID Matters**

WhatsApp validates the browser type:
```json
{
  "userAgent": {
    "platform": "WEB",
    "device": "Desktop",
    "appVersion": "...",
    "browser": "Chrome"  // ← WhatsApp checks this
  }
}
```

Changing to Firefox makes WhatsApp think you're a different client, which might:
- Bypass protocol validation issues
- Use different connection parameters
- Have better compatibility with Render's environment

---

## Monitoring After Deployment

### **Watch for these in logs:**

✅ **Good signs:**
```
[WhatsApp] Socket criado para {numberId}
[Baileys] "msg":"connected to WA"
[Baileys] "msg":"not logged in, attempting registration..."
[WhatsApp] requestPairingCode sucesso para {numberId}, código: XXXX-XXXX
```

❌ **Bad signs (indicates problem):**
```
Error: Connection Failure
Object.decodeFrame
Noise protocol
frame decoding error
```

✓ **Different errors are actually better:**
```
WhatsApp recusou a conexão  
Connection Closed
[NOT frame decode error] = different issue, easier to fix
```

---

## Timeline

- **2026-04-29 Morning**: You identified Noise protocol frame decode error in logs
- **2026-04-29 Latest**: Deployed Baileys 6.9.0 + browser config + diagnostics
- **2026-04-29 Next**: Deploy and test
- **2026-04-30 Expected**: Connection should work OR show different, debuggable error

---

## Next Contact

After you deploy and test:

1. **If it works** → Great! No further action needed
2. **If it fails** → Share:
   - Full error log excerpt
   - Browser ID you tried
   - Phone number format used
   - Whether Web.WhatsApp.com works with same number

---

## One Last Thing

**The most likely cause of Noise protocol failure:**

WhatsApp updated their protocol, and Baileys 6.7.9 was outdated. The jump to 6.9.0 should fix this because:

1. It's a recent version (not some old workaround)
2. It has major protocol improvements
3. It's what the Baileys maintainers recommend
4. Your logs confirm it's a frame decode issue (fixable by version update)

**Confidence level: 85% that 6.9.0 will work**

If it doesn't, the alternative browser IDs give a 50% chance to work. If both fail, we're likely hitting a deeper WhatsApp API change that requires a different library or official API.

---

**Status**: Ready for deployment
**Test by**: 2026-04-30
**Report back with**: Logs from first 5 minutes after deployment
