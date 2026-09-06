# Security

castconjure runs on your machine with your own keys. Things worth reporting privately:

- a way to make the local server spend your fal credits from another web page or origin
- a way to read `FAL_KEY`, chat or LLM keys through the panel, overlay, WebSocket or logs
- a bypass of the real-person / existing-IP guards that lets a viewer or a persona file target a real person

Use GitHub's **Report a vulnerability** on this repository (Security tab). Please include the version or commit and steps to reproduce. You will get an answer within a week; fixes ship in a normal release with credit if you want it.

Not in scope: the safety of the generation models themselves (report those to fal / MiniMax), and cost overruns caused by your own settings — set a session cap in the panel and a monthly cap on the fal dashboard.
