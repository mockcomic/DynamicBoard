@echo off

REM Build the Docker image (clean)
docker build --no-cache -t dynamicboard .

REM Ensure images directory exists
if not exist images mkdir images

REM Timestamp (YYYYMMDDHHMMSS)
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%

REM Save image
docker save -o images\dynamicboard_%TIMESTAMP%.tar dynamicboard
