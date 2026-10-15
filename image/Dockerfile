FROM node:22-bookworm-slim AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui .
RUN npm run build

FROM node:22-bookworm-slim

ARG PI_VERSION=1.2.0

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client jq less unzip procps \
      python3 python3-pip python3-venv ripgrep fd-find \
      chromium tigervnc-standalone-server openbox fonts-noto fonts-noto-color-emoji \
 && ln -s "$(command -v fdfind)" /usr/local/bin/fd \
 && rm -rf /var/lib/apt/lists/*

ARG PLAYWRIGHT_VERSION=1.64.0

# Pi, and the library the daemon drives the browser with (it downloads no browser: Chromium comes from apt).
# NODE_PATH lets the daemon and the extension find these global packages.
ENV NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g --ignore-scripts --omit=dev @earendil-works/pi-coding-agent@${PI_VERSION} playwright-core@${PLAYWRIGHT_VERSION} \
 && npm cache clean --force

# The agents' own installs (npm -g, pip --user) go to /home/node/.local, a volume they share (the daemon gives it to
# their group, `agents`). Debian blocks pip outside a venv; --user installs do not touch the system's packages.
# The browser's profile is the image user's (node), who runs the browser.
RUN mkdir -p /home/node/.local /home/node/.browser && chown node:node /home/node/.browser && chmod 700 /home/node/.browser \
 && groupadd -g 2000 agents
ENV npm_config_prefix=/home/node/.local \
    PYTHONUSERBASE=/home/node/.local \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PATH=/home/node/.local/bin:$PATH

# The window manager draws no frame and maximizes windows: the browser fills the whole screen. A pop-up (a "Sign in
# with Google" window) and a dialog have no tab strip, so no close button of their own: they keep a frame with one, at
# their own size. Openbox applies the rules in order, so the later ones win.
RUN sed -i 's|<applications>|&<application class="*"><decor>no</decor><maximized>yes</maximized></application><application role="pop-up"><decor>yes</decor><maximized>no</maximized></application><application type="dialog"><decor>yes</decor><maximized>no</maximized></application>|' /etc/xdg/openbox/rc.xml

# Pages in the browser cannot open this app or the browser's debugging port.
COPY image/chromium-policy.json /etc/chromium/policies/managed/weilo.json

# What this build is (GET /api/version). Set late, so a new version keeps the layers above in the cache.
ARG VERSION=dev
ARG COMMIT=unknown
ENV WEILO_VERSION=${VERSION} WEILO_COMMIT=${COMMIT} WEILO_PI=${PI_VERSION}
LABEL org.opencontainers.image.title="Weilo Agents"       org.opencontainers.image.version=${VERSION}       org.opencontainers.image.revision=${COMMIT}       org.opencontainers.image.source="https://github.com/Shyam1203/weilo-agents"

COPY daemon /app
COPY --from=ui /ui/dist /app/ui

# The daemon runs as root, and nothing else does: it starts the browser, the curator, the plugins and each agent as a user
# of its own, without root's powers (daemon/users.mjs).
CMD ["node", "/app/server.mjs"]
