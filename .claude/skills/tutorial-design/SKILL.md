---
name: tutorial-design
description: Guidance for creating high-quality, visually appealing, task-oriented end-user tutorial walkthroughs and user guides. Automatically produces interactive single-file HTML tutorials or polished structured Markdown. Strong focus on UX principles including Nielsen heuristics, progressive disclosure, user mental models, common pitfalls, why-this-matters moments, and deliberate visual design choices that avoid generic documentation aesthetics.
---

# Tutorial Design

Approach this as the tutorial lead at a small studio known for giving every client a learning experience that could not be mistaken for anyone else's. This client has already rejected proposals that felt like dry READMEs, generic step-by-step lists, or walls of text, and is paying for a distinctive point of view: make deliberate, opinionated choices about structure, visual language, interactivity, information architecture, and pedagogical approach that are specific to this product, its users, and their real workflows. Take one real pedagogical risk you can justify.

## Ground it in the subject, the codebase, and the user's journey

If the brief does not clearly define the product or feature being taught, the target audience, or the core task, pin it yourself before designing: name one concrete user segment or persona, their primary goal or pain point, their likely current mental model, and the tutorial's single job (for example: "get a brand-new user from signup to first successful deployment in under 10 minutes with high confidence" or "help an existing power user discover and adopt the new bulk-edit workflow they keep overlooking").

When actual project files, codebase, configuration examples, UI screenshots, or command outputs are available, analyze them first. Use real labels, exact commands, actual error messages, configuration keys, expected outputs, and common failure modes from the source material. Never invent placeholder steps or generic commands. The product's own domain language, UI patterns, metaphors, error states, and success criteria are the raw material for distinctive, accurate tutorials.

Build everything around real user tasks and the "why this matters" moments that connect low-level actions to higher-level outcomes and mental model growth. The goal is not just completion of steps, but confident, transferable understanding.

## Design principles for tutorials

Tutorials are interfaces for building mental models. The opening section is both a thesis and a contract with the reader. Clearly and scannably state: who this tutorial is for, what they will be able to do by the end, approximate time required, and what prior knowledge or setup is assumed (or explicitly not assumed). Make the promise honest and the entry point low-friction.

Progressive disclosure is the primary organizing principle. Present the shortest, happiest path to the core value first. Reveal alternatives, advanced options, troubleshooting branches, deeper explanations, and "why this works" only after the user has completed the core action or has explicitly signaled readiness for more. In HTML this means collapsible sections, tabbed variants, or "show advanced" toggles. In Markdown it means clear visual hierarchy, "Optional" and "Advanced" callouts, and explicit "You can stop here" moments.

Recognition over recall must be designed into every screen and section. The user should never have to remember a previous step, hunt for a command, or reconstruct context. Show current state, what just happened, what to expect next, and visible next actions. Use annotated screenshots or diagrams (described precisely or embedded), inline code blocks with surrounding context, consistent visual treatment of UI elements (buttons, fields, menus always rendered the same way), and persistent progress indicators.

Deliberately incorporate Nielsen's usability heuristics into the tutorial's own design and guidance:

- Visibility of system status: Always show where the user is in the overall journey, what the system is currently doing, and what just changed.
- Match between system and real world: Use the product's exact UI language and metaphors. Explain technical concepts by linking them to outcomes the user already cares about.
- User control and freedom: Provide explicit "skip this section", "choose a different path", "go back", undo guidance, and multiple ways to enter or re-enter the tutorial.
- Consistency and standards: Mirror the product's own patterns and terminology exactly. Follow platform conventions for the delivery format (GitHub-flavored Markdown, accessible HTML, etc.).
- Error prevention: Anticipate the most common mistakes at each step and surface them before the user encounters them, with exact prevention or recovery steps.
- Recognition rather than recall: Make all necessary information visible in context. Provide copy-paste ready commands, checklists, and verification steps that do not require memorization.
- Flexibility and efficiency of use: Offer keyboard shortcuts, "power user" faster paths, copy buttons, and accelerators for returning users while keeping the main path simple.
- Aesthetic and minimalist design: Every visual or textual element must earn its place. Use generous but purposeful whitespace, a clear type scale, color used only for meaning (success, warning, info, emphasis), and avoid decorative noise that competes with focus.
- Help users recognize, diagnose, and recover from errors: When errors occur (or are likely), explain what happened in plain language tied to the user's action, show the exact recovery path in the product's UI or CLI language, and reassure without condescension.
- Help and documentation: The tutorial itself is the primary help. Keep it self-contained. Link to deeper reference material only when it genuinely extends the learning rather than being required to complete the core task.

Typography, spacing, and visual markers carry personality and reduce cognitive load. Choose a type scale and pairing appropriate to the product's voice (technical yet approachable, bold and modern, calm and precise). Use consistent heading levels, clear visual weight for steps, purposeful color accents for meaning, and recurring visual devices (colored left borders for callouts, numbered steps with strong affordance, icons via inline SVG or semantic emoji) that encode information rather than merely decorate. The visual system should feel native to the product being documented.

For interactive single-file HTML output (the preferred format when the tutorial is a primary deliverable and the environment supports it): Produce a complete, self-contained HTML file using modern practices. Include Tailwind via CDN for rapid high-quality styling or carefully crafted inline styles + vanilla JS. Required elements: sticky or fixed progress stepper / percentage indicator, collapsible "What just happened / Why this matters" sections, one-click copy for every command and code block, accessible markup with proper ARIA and keyboard navigation, responsive design that works on mobile and desktop, light/dark mode support where appropriate, and a calm, premium visual aesthetic with excellent typography and spacing. Add tasteful interactivity that serves learning: step completion checkboxes that update overall progress (persisted in localStorage when multi-session makes sense), simple branch selectors (e.g., "macOS / Linux / Windows"), or minimal simulated demos when they add clarity without external dependencies or complexity. The finished HTML should feel like a polished product experience, not a converted document.

For structured Markdown fallback (or when HTML is not appropriate): Use rich, semantic structure that renders beautifully in GitHub, Notion, documentation platforms, and print. Include YAML frontmatter for metadata (title, audience, time estimate, last updated, related tutorials). Use task-oriented H2/H3 headings, prerequisite and "What you'll accomplish" callout blocks at the top, clear "Tip / Warning / Note / Why this matters" callouts with consistent visual treatment, Mermaid or ASCII diagrams for flows and mental models, comparison tables, verification checklists, and explicit "Next steps" and "Troubleshooting" sections at the end. Prioritize scannability, low cognitive load, and the ability to jump back in easily.

Structure itself is pedagogical information. Use numbered steps only when strict sequence matters and order carries meaning for the user's mental model. Prefer task-based or goal-based section titles ("Connect your first data source and verify it works") over tool- or command-based titles. Question every structural choice: does this device help the user build an accurate, lasting mental model, or is it inherited template thinking?

Leverage motion and interactivity in HTML with restraint and purpose. A page-load reveal sequence, smooth expand/collapse, or progress that updates live can create a sense of forward momentum and accomplishment. But never add effects that distract, slow the user down, or feel like decoration. Respect reduced-motion preferences. Sometimes the most powerful move is deliberate stillness and clarity.

Match complexity and density to the audience and goal. A quick-start tutorial for new users must be radically simple, confidence-building, and short. An advanced workflow or troubleshooting guide can be denser but must still offer clear escape hatches, progressive disclosure, and respect for the user's existing knowledge. Elegance is executing the chosen pedagogical strategy cleanly and consistently.

Consider every word carefully. Tutorial copy exists to build accurate mental models and reduce anxiety, not to fill space or sound clever. Write from the end user's perspective, using the exact button labels, menu items, error messages, and UI text the product displays. Explain technical concepts by connecting them directly to outcomes the user values ("This setting rebuilds the search index so your queries return results instantly instead of after a long wait").

Use active voice and direct but respectful address. "You will now see your new project listed on the dashboard" beats passive constructions. Be specific and concrete rather than vague or marketing-flavored. "Click the blue Deploy button in the top right of the project header" is always better than "Click the deploy button."

Be encouraging without condescension. Celebrate real progress inline in a natural way. When a step is genuinely tricky or error-prone, say so plainly and respectfully: "This step is where most people get stuck because of X. Here's exactly what to look for and how to recover." Treat errors and unexpected states as teaching moments that strengthen the user's model rather than as failures.

## Process: analyze, journey-map, plan, critique, build, mental test, refine

For calibration: Current AI-generated tutorials frequently default to one of three feels: (1) long, flat numbered lists of commands with minimal context or explanation, (2) dense paragraphs of explanatory text with occasional bolding, or (3) overly chatty, conversational tone that risks talking down to a competent reader. All three read as templated rather than designed for this specific product and audience. When the brief or product voice specifies a direction, follow it exactly. When it leaves an axis open, do not default to any of these. Make choices that feel native to the product's existing communication style and the real workflow of its users.

Work in deliberate passes. 

First pass — Understand reality: If project files, source code, CLI help output, UI descriptions, or existing documentation are provided, explore and extract the actual commands, configuration structure, UI labels, success criteria, common error patterns, and edge cases. Identify the shortest path from user intent to first value and the key "aha" moments along that path.

Second pass — Journey map: Define the core happy path (ideally 3–7 major steps for most tutorials). Identify prerequisite setup, the exact verification moment when the user knows they succeeded, the most likely points of confusion or failure, branching options (different environments, advanced vs basic), and the mental model shifts that should occur at each stage. Explicitly surface the "why this matters" insight for each major section.

Third pass — Design plan: Decide format (interactive self-contained HTML is strongly preferred for new or high-visibility tutorials; rich Markdown for quick reference or when embedding in existing docs sites). Outline the information architecture with progressive disclosure in mind. Define the visual system: type scale and pairing, color roles (meaningful use only), spacing rhythm, callout treatment, progress visualization, and icon language. Identify the signature pedagogical or visual element that will make this tutorial memorable and native to the product (for example: an interactive checklist that mirrors the product's own onboarding checklist, a before/after mental model diagram that gets annotated at each stage, a live-building "copy-paste cheat sheet" that grows as the user completes steps, or a calm, high-contrast "success celebration" state that reinforces the mental model).

Review the plan rigorously against the original brief and against generic defaults. Ask: "Would this plan look essentially the same if the product were completely different?" If yes, revise until the choices are specific to this subject, these users, and these real workflows. Only after this review should you begin writing the actual content or code.

When writing HTML, pay obsessive attention to implementation quality: consistent visual treatment of every interactive element, proper focus indicators, smooth but restrained transitions, working copy-to-clipboard that doesn't break, accessible markup, and a visual hierarchy that guides the eye without overwhelming it. Imagine a slightly tired user at the end of a long day and design for them.

When writing Markdown, ensure it remains beautiful and functional when rendered in multiple contexts (GitHub README, documentation platform, PDF export, print). Include a scannable table of contents for anything longer than a quick start. Add explicit "Prerequisites", "What you'll accomplish", and "Verification checklist" sections that function as both guidance and self-assessment.

## Restraint and self-critique

Spend your design and pedagogical energy in one or two places that matter most. Let the signature element (the interactive progress system, the re-appearing annotated mental model, the beautifully crafted verification moment, the honest and respectful treatment of a tricky step) be the thing the user remembers and returns to. Keep every other element quiet, disciplined, and in service of focus and comprehension. Ruthlessly cut any diagram, explanation, flourish, or extra step that does not build the user's mental model or help them succeed at the core task.

Build to a high quality floor without fanfare: accessible to keyboard and screen reader users, responsive across devices, fast to load (minimal external dependencies for HTML), respectful of the user's time and intelligence, and clear about what constitutes success. Assume the reader is competent and motivated but new to this specific task or product area.

Before declaring the tutorial finished, perform a mental walkthrough as the target user: Can they quickly find their current place if they return later? Do they understand what just happened and why it mattered? Can they recover from the most probable mistake without leaving the tutorial or losing context? Does the visual and information design support calm focus rather than competing for attention? Would a slightly frustrated user feel respected and helped, or talked down to and overwhelmed?

Human creators iterate. If the environment allows quick notes, capture what you tried, what felt generic, and what you changed. This record improves future tutorials for the same product or similar domains.

## More on tone, voice, and copy in tutorials

Every word in a tutorial exists to reduce uncertainty, build an accurate mental model, and move the user toward confident action. Copy is pedagogical material, not decoration or filler.

Write from the end user's side of the interface. Use the exact labels, button text, menu names, placeholder text, and error messages the product actually displays. When you must introduce a technical concept, immediately connect it to a concrete outcome the user cares about rather than leaving it abstract.

Default to active voice and direct address. "You will now see the new index building in the status panel" is clearer and more confidence-building than passive or third-person constructions. Be specific and observable: "Click the green 'Verify Connection' button" beats "Click the verify button."

Tone should be encouraging, precise, and respectful. Celebrate progress naturally when it occurs ("Connection successful — your data source is now live"). When a step is error-prone or conceptually heavy, acknowledge it plainly without apology or condescension: "This is the step where things most often go wrong. The reason is X. Here's the exact sequence that prevents or fixes it."

Treat every error state, empty state, or unexpected result as a teaching opportunity that strengthens the user's model. Provide the recovery path in the product's own language and UI terms. Never make the user feel foolish for encountering a documented pitfall.

Keep paragraphs short, verbs plain, and sentences in natural prose. Match the product's existing voice and register when one exists. Let each element in the tutorial do exactly one job: a heading orients, a step instructs, a callout highlights a key insight or risk, a diagram reveals structure, and nothing quietly performs double duty.

Close the tutorial with clear orientation: "What you just accomplished", "Common and valuable next tasks", "Where to find deeper reference when you need it", and (for HTML) easy navigation back to related tutorials or the main documentation hub. The user should finish feeling capable, oriented, and invited to continue exploring rather than abandoned after the final step.

This completes the core guidance. When in doubt, return to the principles of deliberate choice, progressive disclosure, recognition over recall, and respect for the user's time and intelligence. The best tutorials feel like a trusted, slightly more experienced colleague walking beside the user — clear, calm, precise, and quietly confident in the product and in the learner.
