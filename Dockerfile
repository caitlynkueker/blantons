# QC review engine — Node + ffmpeg + ImageMagick + unzip.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg imagemagick unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Allow ImageMagick to read/write the formats we use (some builds restrict by policy).
RUN if [ -f /etc/ImageMagick-6/policy.xml ]; then \
      sed -i 's/rights="none" pattern="HEIC"/rights="read|write" pattern="HEIC"/g' /etc/ImageMagick-6/policy.xml || true; \
    fi

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
