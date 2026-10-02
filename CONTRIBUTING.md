# Contributing

Improvements are welcome, including from students on the teams that use MealConvene.

## Before your first merge: the CLA

Every contributor signs the [Contributor License Agreement](CLA.md) once, before their first pull request is merged. A bot comments on your pull request; you sign by commenting the sentence it gives.

The CLA lets SoftwareConvene LLC use your contribution under the AGPL **and under other licenses**, including a commercial one or a paid hosted service. You keep your copyright and can use your own work anywhere else. Without the CLA, each outside contribution could only ever be used under the AGPL, and one contributor could block the project's future.

**If you are under 18, you and a parent or guardian both sign.** Don't sign on the pull request first, and don't mention your age there. Email **contact@softwareconvene.org** and we'll send the [guardian form](docs/cla-guardian-form.md). Once it's back, you sign on the pull request like everyone else.

## What you can and can't submit

- Only work you wrote, or work you have the right to submit. If part of it came from somewhere else (code, text, images, a restaurant's menu or images), say so in the pull request and give its source and license. It has to be compatible with the AGPL-3.0.
- Code you produced with an AI tool is your responsibility, the same as code you typed.
- No restaurant logos, photos or copied web pages. Menu item names are fine in a menu template; nothing else from a restaurant's site is.
- No personal data in the code, tests, fixtures or commit messages. Student placeholders are "Student 1", "Student 2" and so on.

## The rules the code holds

- **One limit per order, and the server enforces it.** The number on a student's phone is a convenience; `saveCart` is the guard.
- **A person's identity on an order is their link.** No feature may let someone order as another person, or open a second limit, without the organizer seeing it.
- **Each order keeps its own copy of the menu.** Editing a restaurant never changes an existing order.
- **Lines with notes never merge.**
- **Only names are kept about people.** No emails, phone numbers, ages or grades for students.
- **The cart-fill extension never checks out or pays.** It stops instead of guessing.
- **No ledger.** MealConvene records orders, not money: no balances, budgets or payments.
- **Every page keeps its `/source` link.** That link is how a hosted copy meets AGPL section 13 for the people using it, students included.

A pull request that changes one of these needs to say so in its description.

## Style

- No dependencies without a real argument. There are none on purpose.
- Comments explain **why**, and only where the reason isn't visible in the code.
- Match the surrounding code. There is no separate style guide.
- When you change one of the rules above, add a test to `scripts/test.ts`. Run `npm test`.

## Security

Don't open a public issue for a security problem. Email **contact@softwareconvene.org** and give us a reasonable window before you disclose it.
