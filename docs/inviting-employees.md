# Inviting employees

Only a Super admin can give someone a sign-in. No commands are needed.

## Add a new person and invite them
1. People, **Add employee**.
2. Fill in the name, work email, title, department and hire date. Choose their **Role**.
3. Leave **Send a sign-in invite now** ticked and press **Create profile**.
4. They receive an email with the steps: open the sign-in page, choose **Forgot your password?**, enter their work email, type the emailed code and choose their own password.

## Invite someone who already has a profile
Open their profile, then the **Employee administration** card, then **Send sign-in invite**.
The same card shows where they are:
- **Not invited yet**: no sign-in. Press *Send sign-in invite*.
- **Invited, waiting**: the account exists but they have not signed in. Press *Send the invite again* (resend) or *Withdraw invite*.
- **Active**: they have signed in. If they forget their password they use *Forgot your password?* themselves. To stop access, use **Manage access** and set the account to Inactive.

## Safety rules
- Passwords are never set, shown or sent by an administrator. The person picks their own.
- Only the Super admin can invite or withdraw (HR and managers cannot).
- A sign-in is tied to one employee profile and to the work email on it. Fix the email on the profile first if it is wrong.
- Invites are refused for inactive, former or demo profiles.
- Withdrawing is only possible before the first sign-in. Afterwards deactivate the account instead.
- Every invite, re-send and withdrawal is written to the audit trail.

## How it works
The app asks the Convex backend (`POST /invite`, protected by `INVITE_SECRET`, a different secret from the email one) to create an account with no usable password,
then binds the returned account to the employee in `employee_identities` and queues the invitation email (see `docs/notifications.md`).
If the backend cannot be reached nothing is changed and the screen explains what to do.

Settings: Worker secret `UFS_INVITE_SECRET` and Convex setting `INVITE_SECRET` (same value). Without them the invite controls are hidden.
