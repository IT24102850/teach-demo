# Plus — Teacher Income screens (design handoff)

Design reference only. Nothing in the live repo has been changed.
Open `screens/all-4-screens.html` in a browser (or see the PNG).
Built with plain HTML + CSS, same style as the app (Manrope, black, teal #00C2CB, pink #FF3D8B for "to subscribe").
English only for now.

## The 4 screens

1. **Income (top of Income page)**
   - Graph: "Plus is growing N× faster than tuition". Two lines, both start at the same point (growth since the teacher joined Plus). No money amounts.
   - "Students on Plus — more students every month": one column per month, made of student faces. Current month glows.
   - "Next goal: Add 6 more students → You get +25% Plus income, every month" + button **Invite 6 students**.
2. **Income (further down the same page)**
   - "Almost there: Just 2 more students to your next +25%" (ring shows 4/6).
   - "By class": each class shows subscribed (teal) vs not yet (grey). Label: **"7 parents to subscribe"**. Button: **Remind** (sends the WhatsApp in Draft 1).
3. **Celebration pop-up** — shown when a parent subscribes: "Kasun joined Plus! That's 25 students on Plus." + progress to next goal + **Keep going**.
4. **Digital invite** (no printing) — QR code shown on the teacher's phone in class + WhatsApp invite (Draft 2) + **Copy link**.

## Rules (how the numbers are worked out)

- Every student is in the class list. The teacher marks attendance for **all** students.
- There are **no free parents** in the app. A parent who has not subscribed gets **only the WhatsApp fee reminder** (with a line promoting Plus). Everything else is for subscribed parents.
- **Subscribed** = parent has an active monthly Plus subscription.
- **Growth "N× faster"** = (Plus income growth since joining) ÷ (tuition income growth since joining), rounded. Show only when both have at least 2 months of data.
- **Next goal** = next step of 25% more subscribed students (e.g. 24 → 30). "+25%" = new Plus income ÷ current Plus income − 1.
- **Almost there** shows when the teacher is 1–2 students away from the next goal.
- **By class "to subscribe"** = students in the class − students whose parent is subscribed. Classes with the most left are listed first.
- Do **not** show rupee amounts on these screens.
- Teacher referral bonus: parked for now.

## Data needed (new)

- `subscriptions`: family/student, teacher, status (active / ended), started_on, ended_on.
- Monthly Plus income per teacher (from subscriptions; teacher share 50%).
- Event when a parent subscribes → triggers the celebration pop-up.

See `whatsapp-drafts.md` for the message wording.
