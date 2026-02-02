#!/bin/sh

# Build the Docker image (clean)
docker build --no-cache -t dynamicboard .

# Ensure images directory exists
mkdir -p images

# Timestamp
TIMESTAMP=$(date +%Y%m%d%H%M%S)

# Save image
docker save -o images/dynamicboard_$TIMESTAMP.tar dynamicboard
