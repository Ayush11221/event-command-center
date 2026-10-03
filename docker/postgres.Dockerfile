FROM postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
# The official image's gosu bundles an outdated Go standard library. Use the
# Alpine privilege-drop helper with the same argv/exec behavior instead.
RUN apk add --no-cache su-exec=0.3-r0 && rm /usr/local/bin/gosu && ln -s /sbin/su-exec /usr/local/bin/gosu
