#!/usr/bin/env bash
# Rocky Linux 서버 초기 설정 (app, ops 공통). 여러 번 돌려도 안전하게 작성.
# 사용: sudo bash infra/scripts/setup-server.sh
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "sudo로 실행하세요"; exit 1; }
RUN_USER="${SUDO_USER:-rocky}"

echo "== 스왑 2GB"
if ! swapon --show | grep -q /swapfile; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

echo "== 기본 패키지"
dnf -y -q install dnf-plugins-core git curl firewalld util-linux cronie
systemctl enable --now crond

echo "== 방화벽 (ssh, http, https만)"
systemctl enable --now firewalld
firewall-cmd -q --permanent --add-service=ssh
firewall-cmd -q --permanent --add-service=http
firewall-cmd -q --permanent --add-service=https
firewall-cmd -q --reload

echo "== 쓰지 않는 rpcbind(111) 끄기"
systemctl disable --now rpcbind.socket rpcbind.service 2>/dev/null || true

echo "== SSH: root 로그인, 비밀번호 로그인 금지"
cat > /etc/ssh/sshd_config.d/99-gohae.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
CONF
sshd -t && systemctl reload sshd

echo "== Docker"
if ! command -v docker >/dev/null; then
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  dnf -y -q install docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'CONF'
{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"3"}}
CONF
systemctl enable docker
systemctl restart docker
usermod -aG docker "$RUN_USER"

echo
echo "완료. docker 그룹 적용을 위해 로그아웃 후 다시 접속하세요."
echo "확인: ss -tlnp (22만 보이면 정상), free -h (Swap 2.0Gi)"
