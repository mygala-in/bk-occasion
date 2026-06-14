.PHONY: build-OccasionFunction build-EventFunction build-RsvpFunction build-BgTasksFunction

build-OccasionFunction build-EventFunction build-RsvpFunction build-BgTasksFunction:
	rsync -av --exclude='.aws-sam' --exclude='node_modules' --exclude='.git' --exclude='*.log' . $(ARTIFACTS_DIR)/
	cd $(ARTIFACTS_DIR) && npm install --production
	cd $(ARTIFACTS_DIR)/bk-utils && npm install --production
