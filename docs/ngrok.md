# Share the local app with ngrok

Run these commands from the project root:

```bash
docker compose up -d --build
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN  # only once, if not configured
ngrok http 1711 --traffic-policy-file ./ngrok-host-policy.yml
```

Open the HTTPS **Forwarding** address printed by ngrok. Keep ngrok and Docker running while the link is in use. The Angular development server serves `/api/**` and `/health` through its proxy to the backend container, so one public link covers the app and API. The ngrok policy rewrites the incoming Host header to `localhost`, which Angular accepts without allowing arbitrary hosts.

If you edit `frontend/proxy.conf.json`, restart the frontend service with `docker compose restart frontend` before trying the link again.
