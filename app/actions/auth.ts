"use server";

import prisma from '../lib/prisma';

export async function verifyUser(username: string, password: string) {
  try {
    let user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user && username === 'admin' && password === 'admin') {
      // Auto-seed admin user
      user = await prisma.user.create({
        data: {
          username: 'admin',
          password: 'admin',
          name: 'Super Admin',
          modules: ['Dashboard', 'Samples', 'Patients', 'Departments', 'Test Config', 'Users', 'Settings'],
          departments: []
        }
      });
    }

    if (!user) {
      return { success: false, message: "User not found" };
    }

    if (user.password !== password) {
      return { success: false, message: "Invalid password" };
    }

    return { success: true, user };
  } catch (error) {
    console.error("Auth error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return { success: false, message: "User not found" };
    }

    if (user.password !== currentPassword) {
      return { success: false, message: "Incorrect current password" };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { password: newPassword }
    });

    return { success: true, message: "Password updated successfully" };
  } catch (error) {
    console.error("Change password error:", error);
    return { success: false, message: "Database error" };
  }
}



