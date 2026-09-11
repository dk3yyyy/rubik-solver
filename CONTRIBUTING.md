# Contributing

## Branch Strategy

- `main` — stable, production-ready
- `develop` — integration branch for features/fixes
- `feature/<name>` — new features
- `fix/<name>` — bug fixes

## Workflow

1. Create a branch from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b fix/your-fix-name
   ```

2. Make your changes, commit, and push:
   ```bash
   git add .
   git commit -m "Description of fix"
   git push origin fix/your-fix-name
   ```

3. Open a PR from your branch → `develop` on GitHub

4. After review, PR gets merged into `develop`

5. When ready for release, `develop` → `main`

## Commit Messages

Use clear, concise messages:
- `Fix mobile nav not closing on escape`
- `Add webcam color detection`
- `Improve solver performance`

## Code Style

- Python: PEP 8
- JS: Standard JS style
- CSS: BEM naming convention
