# Makefile đơn giản

push:
	git add .
	git commit -m "SDF" || true
	git push

deploy:
	git stash
	git pull
	git stash apply || true
	docker-compose down
	DOCKER_BUILDKIT=1 docker-compose build
	docker-compose up -d
