# MegaGoldenClub — Shared Template & Design System Lock

## Design source

The supplied MegaGoldenClub flyer is the visual reference for the initial brand direction. The product UI should translate that identity into a professional software design system rather than literally reproduce poster layouts.

## Brand direction

Initial palette families derived from the flyer:
- Royal / deep blue — primary navigation, trust and brand structure
- Magenta / pink — primary calls to action and highlighted promotional states
- Gold / yellow — rewards, prizes and premium emphasis
- White / light surfaces — readable application content
- Green — positive / eligible / completed states
- Neutral grays — operational, accounting and secondary information
- Red — destructive, failed, blocked or overdue states

Exact token values are to be defined in the implementation theme and kept configurable.

## One-design-system rule

The following surfaces must share the same design tokens and reusable component primitives:
- public website
- authentication flows
- member portal
- binary genealogy views
- rewards and lucky-draw screens
- wallet / payout screens
- administration console
- operational forms, tables, dialogs and reports

A module must not invent a separate local visual system.

## Token architecture

```text
Theme
├── brand
│   ├── primary
│   ├── secondary
│   ├── accent
│   └── reward
├── semantic
│   ├── success
│   ├── warning
│   ├── danger
│   └── info
├── surface
├── text
├── border
├── typography
├── spacing
├── radius
├── shadow
├── motion
└── breakpoints
```

Components consume semantic tokens; they should not scatter hard-coded colors throughout page code.

## Shared component system

At minimum:
- AppShell
- Header / Topbar
- Sidebar / navigation
- Button
- Input / Select / Date / Amount controls
- FormField / ValidationMessage
- Card
- StatCard
- RewardCard
- StatusBadge
- Tabs
- DataTable
- Pagination
- Modal / Dialog
- Drawer
- Toast / Alert
- EmptyState
- Loading / Skeleton
- PageHeader
- FilterBar
- ConfirmAction
- ResponsiveStack / Grid

Binary-specific reusable views:
- MemberNode
- GenealogyTree
- LegSummary
- VolumeSummary
- PairStatus

Reward/draw-specific reusable views:
- PrizeCard
- DrawRoundCard
- EligibilityStatus
- WinnerCard
- FulfilmentStatus

## Template architecture

Presentation must be template-based and content/configuration must remain separate from business logic.

```text
Published Theme
      +
Published Page/Screen Template
      +
CMS / business data
      =
Rendered UI
```

Templates may control:
- layout
- section order
- visibility
- hero/banner treatment
- card composition
- media placement
- CTA placement
- navigation/footer variants

Templates must not contain compensation calculations, eligibility logic or financial business rules.

## Admin configurability

Controlled theme settings may include:
- logos / brand assets
- primary/secondary/accent token values
- gradients
- typography choices from approved application fonts
- border radius scale
- banners and hero media
- CMS sections
- CTA copy
- navigation/footer content
- publication state and version

Theme configuration must preserve contrast, accessibility and component consistency.

## Public vs operational density

The same brand system may use different density profiles:
- Public/reward marketing screens: more expressive, promotional and visual
- Member/admin operational screens: cleaner, denser and data-focused

Both remain recognizably MegaGoldenClub and use the same token/component foundation.

## Responsive rule

Mobile, tablet and desktop behavior is defined at the shared component/template level. Individual pages should not rely on one-off responsiveness hacks that break consistency.
