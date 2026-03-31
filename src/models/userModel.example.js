import { query } from '../config/db.js';

/**
 * Example database model structure using node-postgres.
 * Methods here only deal with interacting with the db table.
 */
class UserModel {
  // Find a user by email
  static async findByEmail(email) {
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0];
  }

  // Create a new user
  static async create(userData) {
    const { email, password, role } = userData;
    const { rows } = await query(
      'INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role',
      [email, password, role]
    );
    return rows[0];
  }
}

export default UserModel;
