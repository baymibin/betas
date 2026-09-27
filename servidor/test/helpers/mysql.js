// Solo para pruebas: recrea una base MySQL/MariaDB vacía. Se niega si el nombre no acaba en _test.
export async function resetMysql(url) {
  const name = new URL(url).pathname.slice(1);
  if (!/_test$/.test(name)) throw Error('TEST_MYSQL_URL debe apuntar a una base de datos que termine en _test');
  const mysql = (await import('mysql2/promise')).default;
  const root = new URL(url); root.pathname = '/';
  const connection = await mysql.createConnection({uri: root.href});
  await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end();
}
