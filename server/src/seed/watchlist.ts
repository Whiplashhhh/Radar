export interface SeedWatch {
  name: string;
  aliases: string[];
  cpes?: string[];
  packages?: string[];
  exclude?: string[];
}

/**
 * Watchlist initiale. Alias préfixé par `=` : sensible à la casse.
 * Les CPE sont au format `vendor:product` du dictionnaire NVD.
 */
export const SEED_WATCHLIST: SeedWatch[] = [
  { name: 'Java / OpenJDK', aliases: ['OpenJDK', 'Java SE', 'JDK', 'JRE', 'Oracle Java', 'HotSpot', 'Java Runtime Environment'], cpes: ['oracle:jdk', 'oracle:jre', 'oracle:openjdk', 'eclipse:temurin', 'azul:zulu'], exclude: ['JavaScript'] },
  { name: 'Spring', aliases: ['Spring Boot', 'Spring Framework', 'Spring Security', 'Spring MVC', 'Spring WebFlux', 'Spring Cloud', 'Spring4Shell'], cpes: ['vmware:spring_boot', 'vmware:spring_framework', 'vmware:spring_security', 'pivotal_software:spring_framework', 'broadcom:spring_*'], packages: ['maven:org.springframework.boot:*', 'maven:org.springframework:*', 'maven:org.springframework.security:*'] },
  { name: 'Vue.js', aliases: ['Vue.js', 'VueJS', 'Vue 3', 'Vue Router', 'Nuxt'], cpes: ['vuejs:vue', 'vuejs:vue.js', 'nuxt:nuxt'], packages: ['npm:vue', 'npm:@vue/*', 'npm:vue-router', 'npm:nuxt'] },
  { name: 'React', aliases: ['=React', 'React.js', 'ReactJS', 'React Native', 'React Server Components', 'Next.js'], cpes: ['facebook:react', 'meta:react', 'vercel:next.js'], packages: ['npm:react', 'npm:react-dom', 'npm:react-server-dom-*', 'npm:next'] },
  { name: 'Node.js', aliases: ['Node.js', 'NodeJS', 'Node JS'], cpes: ['nodejs:node.js', 'nodejs:nodejs'], packages: ['npm:undici'] },
  { name: 'TypeScript', aliases: ['TypeScript'], cpes: ['microsoft:typescript'], packages: ['npm:typescript'] },
  { name: 'Flutter / Dart', aliases: ['Flutter', '=Dart', 'Dart SDK'], cpes: ['google:flutter', 'dart:dart', 'google:dart'], packages: ['pub:flutter*'] },
  { name: 'Python', aliases: ['Python', 'CPython', 'Python 3'], cpes: ['python:python'], exclude: ['Monty Python'] },
  { name: 'PostgreSQL', aliases: ['PostgreSQL', 'Postgres'], cpes: ['postgresql:postgresql'], packages: ['pip:psycopg*', 'npm:pg', 'maven:org.postgresql:postgresql'] },
  { name: 'SQLite', aliases: ['SQLite', 'SQLite3'], cpes: ['sqlite:sqlite'], packages: ['npm:better-sqlite3', 'npm:sqlite3'] },
  { name: 'Docker', aliases: ['Docker', 'Docker Engine', 'Moby', 'containerd', 'runc', 'BuildKit'], cpes: ['docker:docker', 'docker:engine', 'mobyproject:moby', 'linuxfoundation:containerd', 'linuxfoundation:runc'], exclude: ['Docker Desktop', 'Docker Hub image'] },
  { name: 'Ubuntu', aliases: ['Ubuntu'], cpes: ['canonical:ubuntu_linux'] },
  { name: 'Noyau Linux', aliases: ['Linux kernel', 'noyau Linux', 'kernel Linux', 'Linux Kernel'], cpes: ['linux:linux_kernel'] },
  { name: 'OpenSSH', aliases: ['OpenSSH', 'sshd'], cpes: ['openbsd:openssh'] },
  { name: 'Tailscale', aliases: ['Tailscale'], cpes: ['tailscale:tailscale'] },
  { name: 'Immich', aliases: ['Immich'], cpes: ['immich:immich', 'immich-app:immich'] },
  { name: 'n8n', aliases: ['n8n'], cpes: ['n8n:n8n'], packages: ['npm:n8n', 'npm:n8n-*'] },
  { name: 'Ollama', aliases: ['Ollama'], cpes: ['ollama:ollama'] },
  { name: 'Pi-hole', aliases: ['Pi-hole', 'Pihole', 'FTLDNS'], cpes: ['pi-hole:pi-hole', 'pi-hole:ftldns', 'pi-hole:web_interface'] },
  { name: 'WordPress', aliases: ['WordPress'], cpes: ['wordpress:wordpress'], exclude: ['plugin for WordPress', 'WordPress plugin', 'theme for WordPress', 'WordPress theme', 'plugins for WordPress'] },
  { name: 'Chrome', aliases: ['Google Chrome', 'Chrome', 'Chromium'], cpes: ['google:chrome'], exclude: ['Chrome extension', 'Chrome extensions'] },
];
