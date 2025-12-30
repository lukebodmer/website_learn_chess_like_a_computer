# Project Guidelines for learnchesslikeacomputer.org

## Tech Stack
- Python
- Flask web framework
- Nix flake–based project (`flake.nix` manages dependencies)

## Dependency Management
- Flask is already installed via `flake.nix`
- Any new Python or system dependencies must be added to `flake.nix`
- Do not assume global Python packages
- If a dependency is needed, chose a simple reliable one over a niche one.

## Project Structure
- Use a clean, modular Flask project layout
- Separate concerns clearly (routes, templates, static assets, configuration)
- Structure the project so it is easy to extend as complexity grows
- Avoid monolithic files

## Code Style Preferences
- Prefer **simple, small functions** with **clear, descriptive names**
- Avoid long or overly complex functions
- Avoid defining functions inside other functions
- Prefer modular code over duplicated logic
- Favor readability and maintainability over cleverness

## Flask Usage
- Keep routes clear and well-organized
- Use templates appropriately for page structure
- Use placeholders where data or visuals will be generated later

## Frontend Expectations
- Simple, clean, modern design
- Responsive layout for different screen sizes
- No unnecessary complexity in styling or layout logic

## General Principles
- Optimize for long-term maintainability
- Code should be understandable to someone new to the project
- Make growth and future features easy to integrate
