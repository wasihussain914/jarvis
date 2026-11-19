# JARVIS on AWS (EC2 + Bedrock)

One CloudFormation stack puts JARVIS on a single EC2 instance:

- **Brain:** Claude on Amazon Bedrock, using the instance's IAM role, so there are no API keys anywhere.
- **Face:** served over HTTPS at a free `https://<ip>.sslip.io` address (Caddy fetches the certificate), behind a password. Browsers only allow the microphone on HTTPS.
- **Hands:** a headless Chromium (Playwright MCP) for browsing, plus the job-hunter skill (`job-hunter.md`). It finds internships from the SimplifyJobs lists and drafts application answers, and it never submits anything.
- **Push-to-talk** is on, which suits a noisy room: hold Space to talk.

Built for the AWS Student Builder Group @ Vanderbilt "AWS 101: Build Your Own Jarvis" workshop.

## Deploy (about 10 minutes)

1. Open the AWS console in region **us-east-1** and go to **CloudFormation → Create stack → Upload a template file**. Upload `aws/jarvis.yaml`.
2. Name the stack `jarvis` and set a **JarvisPassword** of 8+ characters. You can leave everything else at the defaults.
3. Tick "I acknowledge that AWS CloudFormation might create IAM resources" and click **Submit**.
4. When the stack shows `CREATE_COMPLETE`, wait about 6 more minutes for the install to finish. Then open the **JarvisUrl** output in Chrome and log in as user `tony` with your password.
5. Click **INITIALISE** and allow the microphone. Hold **Space**, talk, and let go.

Things to try: "Find me 3 new software engineering internships", "Help me answer the questions for <job link>".

## Parameters

| Parameter | Default | Notes |
|---|---|---|
| `JarvisPassword` | (required) | Password for the web page. The username is `tony` |
| `ModelId` | Claude Haiku 4.5 | Haiku is fastest for voice. Sonnet 4.6 is also available |
| `AllowWrites` | `0` | `1` lets JARVIS click and type in its browser (needed to fill forms) |
| `InstanceType` | `t3.medium` | t3.large if builds are slow |
| `RepoUrl` | this repo | Point at your own fork to deploy your changes |

**First time using Claude on Bedrock?** New AWS accounts have to submit Anthropic's one-time use-case form in the Bedrock console (Model catalog → any Claude model) before the first call works.

## Operate

- **Shell:** use the **ConnectShell** output (Session Manager, no SSH keys needed).
- **Logs:** run `sudo tail -50 /var/log/jarvis-setup.log` for the install, and `journalctl -u jarvis-bridge -f` for JARVIS.
- **Add an ElevenLabs voice:** create a systemd drop-in with `Environment=ELEVENLABS_API_KEY=...` under `/etc/systemd/system/jarvis-bridge.service.d/`, then run `systemctl daemon-reload && systemctl restart jarvis-bridge`.
- **Update after pushing to your fork:** run `cd /home/ubuntu/jarvis && sudo -u ubuntu git pull && sudo -u ubuntu npm run build && sudo systemctl restart jarvis-bridge`.

## Cost and cleanup

A t3.medium costs about $0.04/hour, the Elastic IP is free while it's attached, and a Haiku voice turn costs about a cent. **Delete the stack when you're done.** That removes everything it created.

## Connecting your own agent

You can point the EC2 JARVIS at your personal agent with `JARVIS_AGENT_URL` and `JARVIS_AGENT_TOKEN` (see [../docs/connect-your-agent.md](../docs/connect-your-agent.md)). Only do this over a private network such as Tailscale. Never expose your agent's API to the internet so a cloud server can reach it.
