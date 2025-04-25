# Dynamicboard

## 🎥 Video Demo

[Watch the demo](https://github.com/mockcomic/DynamicBoard/assets/1287667/3df06ce9-a22e-4fae-8dfe-7bc9935d1821)

## Description

Dynamic VestaBoard allows you to send messages to your Vestaboard at timed intervals, enhancing communication efficiency.

## Available Functions

All functions must be rapped with `{}`. For example, `Christmas is in {tillDate(12,25,2025)}!`

- tillDate(dd,nn,yyyy)
  - Returns how many days till date specified
  - Will count up after passing the date
- date()
  - Returns the current date

## Environment Setup

When the program is first launched, it will create a `config.json` file in the same directory. In the config file, enter your `apiWriteKey`, which can be found in the Vestaboard app under `Settings → Advanced Settings → Read/Write API`.
