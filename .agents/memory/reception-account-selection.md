---
name: Reception account selection
description: Keep trusted-device clinic context separate from reception account identity.
---

Reception uses its registered device's clinic and an account email plus PIN; never infer an account from clinic and PIN alone.

**Why:** A clinic may have multiple reception users, including users sharing a device or the same four-digit PIN. Account identity must remain unambiguous for authorization, audit and per-user tour state.

**How to apply:** The trusted cookie establishes the clinic boundary, not a user session. Expose only that clinic before login, never a public clinic/account directory. Keep device enrollment administrator-only.
