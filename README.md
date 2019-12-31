# OJ-Web

This is the main component of the online judge. You should run this

## Usage

Copy `config.example.json` to `config.json`, then modify `config.json` as needed. Then simply run `yarn` and then launch `index.js` using whatever method, either `node`, `pm2` or `nodemon`.

## Authentication

This application stores the username and salted hashes of password.

When you launch the application with an empty database, the application creates an admin user with username `admin` and password `admin`. (Note that you can't create user with password shorter than 6 characters.)

## User Management

The user management functionality is not implemented yet. You can register as a normal user (basic functionalities like submit) but you cannot create an admin user yet. This functionality will be implemented soon.
