# ============================================================================
# Copyright (C) 2025, MdeCpp team.
# All rights reserved. See files LICENSE for details.
#
# File: hugo-yicai/Makefile
# Author: Yi Cai
# E-mail: yicaim@stu.xmu.edu.cn
# ============================================================================

# Naming convention:
#   Targets: lowercase with hyphens, e.g., unit-test-generic 
#   Variables: uppercase with underscores, e.g., ROOT_DIR

ROOT_DIR = $(PWD)
BUILD_DIR = $(ROOT_DIR)/build

.PHONY: deploy
deploy:
	@hugo --minify
	@cd public
	@make git-save
	@cd ..


#=======================================================================
# GIT prompts 
#=======================================================================

# Repository configuration
REPOS_NAME = escapetiger.github.io
REPOS_URL = git@github.com:escapetiger/$(REPOS_NAME).git
REPOS_BRANCH = main
REPOS_REMOTE = origin

# Default commit message (can be overridden: make git-commit MSG="your message")
COMMIT_MSG ?= Updated at $(shell date +"%Y-%m-%d %H:%M:%S")

# User credentials (can be overridden: make git-login NAME="Your Name" EMAIL="you@example.com")
USER_NAME ?= escapetiger
USER_EMAIL ?= cy992236@outlook.com

#-----------------------------------------------------------------------
# Repository initialization (one-time setup)
#-----------------------------------------------------------------------

# Configure git user credentials
# Usage: make git-login NAME="Your Name" EMAIL="you@example.com"
#   or:  make git-login-global NAME="Your Name" EMAIL="you@example.com"
.PHONY: git-login
git-login:
	@if [ -z "$(USER_NAME)" ] || [ -z "$(USER_EMAIL)" ]; then \
		echo "ERROR: Please provide both USER_NAME and USER_EMAIL"; \
		echo "Usage: make git-login USER_NAME=\"Your Name\" USER_EMAIL=\"you@example.com\""; \
		exit 1; \
	fi
	@echo "==> Configuring git user for this repository..."
	@git config user.name "$(USER_NAME)"
	@git config user.email "$(USER_EMAIL)"
	@echo "==> Git user configured successfully:"
	@echo "    Name:  $$(git config user.name)"
	@echo "    Email: $$(git config user.email)"

# Configure git user credentials globally (all repositories)
# Usage: make git-login-global NAME="Your Name" EMAIL="you@example.com"
.PHONY: git-login-global
git-login-global:
	@if [ -z "$(USER_NAME)" ] || [ -z "$(USER_EMAIL)" ]; then \
		echo "ERROR: Please provide both USER_NAME and USER_EMAIL"; \
		echo "Usage: make git-login-global USER_NAME=\"Your Name\" USER_EMAIL=\"you@example.com\""; \
		exit 1; \
	fi
	@echo "==> Configuring git user globally..."
	@git config --global user.name "$(USER_NAME)"
	@git config --global user.email "$(USER_EMAIL)"
	@echo "==> Git user configured globally:"
	@echo "    Name:  $$(git config --global user.name)"
	@echo "    Email: $$(git config --global user.email)"

# Show current git user configuration
# Usage: make git-whoami
.PHONY: git-whoami
git-whoami:
	@echo "==> Current git user configuration:"
	@echo "  Local (repository):"
	@echo "    Name:  $$(git config user.name 2>/dev/null || echo '<not set>')"
	@echo "    Email: $$(git config user.email 2>/dev/null || echo '<not set>')"
	@echo ""
	@echo "  Global (system-wide):"
	@echo "    Name:  $$(git config --global user.name 2>/dev/null || echo '<not set>')"
	@echo "    Email: $$(git config --global user.email 2>/dev/null || echo '<not set>')"

# Initialize a new git repository and push to remote
# Usage: make git-init
.PHONY: git-init
git-init:
	@echo "==> Initializing git repository..."
	@git init
	@git add .
	@git commit -m "Initial commit"
	@git branch -M $(REPOS_BRANCH)
	@git remote add $(REPOS_REMOTE) $(REPOS_URL)
	@git push -u $(REPOS_REMOTE) $(REPOS_BRANCH)
	@echo "==> Repository initialized and pushed to $(REPOS_URL)"

#-----------------------------------------------------------------------
# Daily workflow commands
#-----------------------------------------------------------------------

# Show repository status
# Usage: make git-status
.PHONY: git-status
git-status:
	@echo "==> Repository status:"
	@git status

# Show commit history
# Usage: make git-log
.PHONY: git-log
git-log:
	@git log --oneline --graph --decorate --all -10

# Show detailed diff of changes
# Usage: make git-diff
.PHONY: git-diff
git-diff:
	@echo "==> Unstaged changes:"
	@git diff
	@echo ""
	@echo "==> Staged changes:"
	@git diff --cached

# Add all changes to staging area
# Usage: make git-add
.PHONY: git-add
git-add:
	@echo "==> Staging all changes..."
	@git add .
	@git status --short

# Commit staged changes with message
# Usage: make git-commit MSG="your message"
.PHONY: git-commit
git-commit:
	@if [ -z "$(MSG)" ]; then \
		echo "==> Committing with default message: $(COMMIT_MSG)"; \
		git commit -m "$(COMMIT_MSG)"; \
	else \
		echo "==> Committing with message: $(MSG)"; \
		git commit -m "$(MSG)"; \
	fi
	@git log -1 --oneline

# Quick add and commit in one step
# Usage: make git-ac MSG="your message"
.PHONY: git-ac
git-ac:
	@echo "==> Staging all changes..."
	@git add .
	@$(MAKE) git-commit MSG="$(MSG)"

#-----------------------------------------------------------------------
# Synchronization with remote
#-----------------------------------------------------------------------

# Pull latest changes from remote (fetch + merge)
# Usage: make git-pull
.PHONY: git-pull
git-pull:
	@echo "==> Pulling latest changes from $(REPOS_REMOTE)/$(REPOS_BRANCH)..."
	@git pull $(REPOS_REMOTE) $(REPOS_BRANCH)
	@echo "==> Pull complete"

# Pull with rebase (cleaner history)
# Usage: make git-pull-rebase
.PHONY: git-pull-rebase
git-pull-rebase:
	@echo "==> Pulling with rebase from $(REPOS_REMOTE)/$(REPOS_BRANCH)..."
	@git pull --rebase $(REPOS_REMOTE) $(REPOS_BRANCH)
	@echo "==> Pull with rebase complete"

# Push local commits to remote
# Usage: make git-push
.PHONY: git-push
git-push:
	@echo "==> Pushing to $(REPOS_REMOTE)/$(REPOS_BRANCH)..."
	@git push $(REPOS_REMOTE) $(REPOS_BRANCH)
	@echo "==> Push complete"

# Complete sync: pull, then push
# Usage: make git-sync
.PHONY: git-sync
git-sync:
	@echo "==> Syncing with remote..."
	@$(MAKE) git-pull
	@$(MAKE) git-push
	@echo "==> Sync complete"

#-----------------------------------------------------------------------
# Common workflows (compound operations)
#-----------------------------------------------------------------------

# Local to Web: Add all, commit, and push
# Usage: make git-save MSG="your message"
.PHONY: git-save
git-save save:
	@echo "==> Saving changes to remote..."
	@git add .
	@$(MAKE) git-commit MSG="$(MSG)"
	@$(MAKE) git-push
	@echo "==> Changes saved to remote successfully"

# Web to Local: Fetch and show what's new, then merge
# Usage: make git-update
.PHONY: git-update
git-update:
	@echo "==> Fetching changes from remote..."
	@git fetch $(REPOS_REMOTE)
	@echo ""
	@echo "==> New commits on remote:"
	@git log HEAD..$(REPOS_REMOTE)/$(REPOS_BRANCH) --oneline --graph --decorate || echo "No new commits"
	@echo ""
	@read -p "Merge changes? [y/N]: " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		echo "==> Merging changes..."; \
		git merge $(REPOS_REMOTE)/$(REPOS_BRANCH); \
		echo "==> Update complete"; \
	else \
		echo "==> Merge cancelled"; \
	fi

#-----------------------------------------------------------------------
# Utility commands
#-----------------------------------------------------------------------

# Undo last commit (keep changes staged)
# Usage: make git-undo-commit
.PHONY: git-undo-commit
git-undo-commit:
	@echo "==> Undoing last commit (keeping changes staged)..."
	@git reset --soft HEAD~1
	@git status

# Discard all uncommitted changes (DANGEROUS!)
# Usage: make git-reset-hard
.PHONY: git-reset-hard
git-reset-hard:
	@echo "WARNING: This will discard ALL uncommitted changes!"
	@read -p "Are you sure? [y/N]: " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		git reset --hard HEAD; \
		git clean -fd; \
		echo "==> All changes discarded"; \
	else \
		echo "==> Reset cancelled"; \
	fi

# Show current branch and remote info
# Usage: make git-info
.PHONY: git-info
git-info:
	@echo "==> Repository Information:"
	@echo "  Current branch: $$(git branch --show-current)"
	@echo "  Remote URL:     $$(git remote get-url $(REPOS_REMOTE))"
	@echo "  Tracking:       $$(git branch -vv | grep '*' | cut -d' ' -f4-)"
	@echo "  Latest commit:  $$(git log -1 --oneline)"

# Create a new branch
# Usage: make git-branch-create BRANCH=feature-name
.PHONY: git-branch-create
git-branch-create:
	@if [ -z "$(BRANCH)" ]; then \
		echo "ERROR: Please specify BRANCH=name"; \
		exit 1; \
	fi
	@echo "==> Creating and switching to branch: $(BRANCH)"
	@git checkout -b $(BRANCH)

# Switch to existing branch
# Usage: make git-branch-switch BRANCH=branch-name
.PHONY: git-branch-switch
git-branch-switch:
	@if [ -z "$(BRANCH)" ]; then \
		echo "ERROR: Please specify BRANCH=name"; \
		exit 1; \
	fi
	@echo "==> Switching to branch: $(BRANCH)"
	@git checkout $(BRANCH)

#-----------------------------------------------------------------------
# Help
#-----------------------------------------------------------------------

# Show available git shortcuts
# Usage: make git-help
.PHONY: git-help
git-help:
	@echo "Git Makefile Shortcuts"
	@echo "======================"
	@echo ""
	@echo "User Configuration:"
	@echo "  make git-login NAME='name' EMAIL='email'        - Configure git user (local)"
	@echo "  make git-login-global NAME='name' EMAIL='email' - Configure git user (global)"
	@echo "  make git-whoami                                 - Show current git user config"
	@echo ""
	@echo "Daily Workflow:"
	@echo "  make git-status               - Show repository status"
	@echo "  make git-log                  - Show commit history (last 10)"
	@echo "  make git-diff                 - Show diff of changes"
	@echo "  make git-add                  - Stage all changes"
	@echo "  make git-commit MSG='msg'     - Commit with message"
	@echo "  make git-ac MSG='msg'         - Add and commit in one step"
	@echo ""
	@echo "Remote Synchronization:"
	@echo "  make git-pull                 - Pull changes from remote"
	@echo "  make git-pull-rebase          - Pull with rebase"
	@echo "  make git-push                 - Push to remote"
	@echo "  make git-sync                 - Pull then push"
	@echo ""
	@echo "Common Workflows:"
	@echo "  make git-save MSG='msg'       - Add, commit, and push"
	@echo "  make git-update               - Fetch and merge from remote"
	@echo ""
	@echo "Branch Management:"
	@echo "  make git-branch-create BRANCH=name"
	@echo "  make git-branch-switch BRANCH=name"
	@echo ""
	@echo "Utilities:"
	@echo "  make git-info              - Show repository information"
	@echo "  make git-undo-commit       - Undo last commit (keep changes)"
	@echo "  make git-reset-hard        - Discard ALL changes (DANGEROUS!)"
	@echo ""
	@echo "Examples:"
	@echo "  make git-login NAME='John Doe' EMAIL='john@example.com'"
	@echo "  make git-save MSG='Add new feature'"
	@echo "  make git-ac MSG='Fix bug in IndexIterator'"
	@echo "  make git-update"
	@echo ""
